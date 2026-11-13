import "server-only";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { grayscaleSimilarity, judgeClip, judgeFinal, nextAttempt, canTransition, type VersionState } from "../../core/pipeline-rules";
import type { RegistryModel } from "../../core/routing-rules";
import { billedDuration, estimateSceneCredits, fnv1a, totalRuntime } from "../../core/storyboard-rules";
import { buildTimeline } from "../../core/timeline";
import type { Asset, BusinessProfile, FinalVideo, Project, ProjectStatus, RenderJob, Scene, StoryboardVersion } from "../../types";
import { scoreClip } from "../ai/qa";
import { audit } from "../audit";
import { env } from "../env";
import { conflict } from "../http";
import { extractFrames, mockAssemble, mockClipFromImage, probeFile, volumeStats, withTempDir, audioDuration, type Probe } from "../media/ffmpeg";
import { grayRaster, toJpegBase64 } from "../media/image";
import { renderStatus, submitRender } from "../media/shotstack";
import { synthesizeVoiceover } from "../media/voice";
import { adapterFor } from "../providers";
import { ProviderError } from "../providers/types";
import { getObject, putObject, signedUrl, signedUrls } from "../storage";
import { db, must } from "../db";
import { loadScenes, loadVersion } from "./projects";
import { loadRegistry } from "./registry";

const PROMPT_SUFFIX = "The background, mirrors, furniture and signage stay exactly as in the photo. No text, no logos, no new people.";
const NEGATIVE_PROMPT = "text, letters, numbers, logo, watermark, extra people, distorted hands, warped face, melting objects, changed background";
const POLL_INTERVAL_MS = 8_000;
const JOB_TIMEOUT_MS = 45 * 60_000;
const MAX_TRANSIENT_ERRORS = 3;
const MAX_ASSEMBLY_ATTEMPTS = 2;
const MAX_QA_PER_TICK = 2;

const now = () => new Date().toISOString();

// ------------------------------------------------------------------ helpers

async function setVersionState(version: StoryboardVersion, to: VersionState, extra: Record<string, unknown> = {}) {
  if (version.state === to) return;
  if (!canTransition(version.state as VersionState, to)) {
    console.warn(`[render] skip invalid transition ${version.state} -> ${to} for ${version.id}`);
    return;
  }
  must(await db().from("storyboard_versions").update({ state: to, ...extra }).eq("id", version.id).eq("state", version.state), "version state");
  version.state = to;
}

async function updateScene(sceneId: string, patch: Partial<Scene>) {
  must(await db().from("scenes").update(patch).eq("id", sceneId), "update scene");
}

async function updateJob(jobId: string, patch: Partial<RenderJob> & Record<string, unknown>) {
  must(await db().from("render_jobs").update({ ...patch, updated_at: now() }).eq("id", jobId), "update job");
}

function withSuffix(prompt: string): string {
  const p = prompt.trim();
  return /exactly as in the photo/i.test(p) ? p : `${p} ${PROMPT_SUFFIX}`.trim();
}

async function loadAsset(id: string | null): Promise<Asset | null> {
  if (!id) return null;
  return must(await db().from("assets").select("*").eq("id", id).maybeSingle(), "load asset") as Asset | null;
}

// ------------------------------------------------------------------ jobs (FR-21)

export async function createJob(opts: {
  project: Pick<Project, "id">;
  version: StoryboardVersion;
  scene: Scene;
  model: RegistryModel;
  attempt: number;
  initiatedBy: string;
}): Promise<RenderJob> {
  const { project, version, scene, model, attempt } = opts;
  const key = `${scene.id}:${attempt}:${model.model_id}`;
  const est = estimateSceneCredits(model, scene.duration_s, "animate");
  // The database trigger rejects this insert unless the version is approved (FR-19).
  const inserted = await db()
    .from("render_jobs")
    .insert({
      project_id: project.id,
      storyboard_version_id: version.id,
      scene_id: scene.id,
      provider: env.mediaMode() === "mock" ? "mock" : model.provider,
      model_id: model.model_id,
      attempt,
      initiated_by: opts.initiatedBy,
      idempotency_key: key,
      est_credits: est,
    })
    .select("*")
    .single();
  let job: RenderJob;
  if (inserted.error) {
    if (inserted.error.code !== "23505") throw new Error(`create job: ${inserted.error.message}`);
    job = must(await db().from("render_jobs").select("*").eq("idempotency_key", key).single(), "load existing job") as RenderJob;
  } else {
    job = inserted.data as RenderJob;
  }
  await updateScene(scene.id, { render_status: "rendering" });
  return job;
}

/** Create first-attempt jobs for animated scenes, reusing clips that already passed QA (FR-22). */
async function ensureSceneJobs(project: Pick<Project, "id">, version: StoryboardVersion) {
  const [scenes, registry, existing] = await Promise.all([
    loadScenes(version.id),
    loadRegistry(),
    db().from("render_jobs").select("scene_id").eq("storyboard_version_id", version.id),
  ]);
  const withJobs = new Set((must(existing, "existing jobs") as { scene_id: string }[]).map((j) => j.scene_id));
  const pending = scenes.filter((s) => s.treatment === "animate" && s.render_status === "pending" && !withJobs.has(s.id));
  if (!pending.length) return { jobs: 0, reused: 0 };
  const byId = new Map(registry.models.map((m) => [m.model_id, m]));
  const versionIds = (must(await db().from("storyboard_versions").select("id").eq("project_id", project.id), "project versions") as { id: string }[]).map((v) => v.id);
  const previous = must(
    await db()
      .from("scenes")
      .select("id, render_key, clip_path")
      .in("storyboard_version_id", versionIds)
      .eq("render_status", "passed")
      .not("clip_path", "is", null),
    "load reusable clips",
  ) as { id: string; render_key: string; clip_path: string }[];
  const reusable = new Map(previous.map((p) => [p.render_key, p]));

  let jobs = 0;
  let reused = 0;
  for (const s of pending) {
    const prior = reusable.get(s.render_key);
    if (prior && prior.id !== s.id) {
      await updateScene(s.id, { render_status: "passed", clip_path: prior.clip_path, reused_from_scene_id: prior.id });
      reused++;
      continue;
    }
    const model = s.model_id ? byId.get(s.model_id) : undefined;
    if (!model) {
      await updateScene(s.id, { render_status: "needs_review", route_flag: "model_missing_at_render" });
      await db().from("qa_results").insert({
        scene_id: s.id,
        kind: "scene",
        overall: "fail",
        flags: ["model_missing"],
        summary: `Scene ${s.scene_order}: the routed model is no longer in the registry. Re-render with another model.`,
        needs_review: true,
      });
      continue;
    }
    await createJob({ project, version, scene: s, model, attempt: 1, initiatedBy: "system" });
    jobs++;
  }
  return { jobs, reused };
}

/** Approval kicks off rendering. */
export async function startRendering(project: Project, versionId: string, actor: string) {
  const version = await loadVersion(versionId);
  if (!version.approved_at || version.state !== "approved") throw conflict("Only an approved storyboard can be rendered.");
  const { jobs, reused } = await ensureSceneJobs(project, version);
  await setVersionState(version, "rendering");
  await syncProjectStatus(project.id);
  await audit(project.id, actor, "render.started", { version: version.version, jobs, reused_clips: reused });
}

async function submitJob(job: RenderJob, scene: Scene, models: Map<string, RegistryModel>) {
  const claim = must(await db().rpc("claim_render_job", { p_job_id: job.id }), "claim job") as { ok: boolean; reason?: string };
  if (!claim.ok) {
    if (claim.reason === "credit_cap" || claim.reason === "not_approved") {
      await audit(job.project_id, "render-service", `render.blocked.${claim.reason}`, { job: job.id, ...claim });
    }
    return;
  }
  const model = models.get(job.model_id);
  const asset = await loadAsset(scene.background_asset_id);
  if (!model || !asset?.vertical_path) {
    await updateJob(job.id, { status: "failed", failure_kind: "provider", error: !model ? "Model no longer in registry." : "Background photo was deleted.", credits_used: 0 });
    await handleJobFailure({ ...job, status: "failed" }, scene, "provider");
    return;
  }
  const imageUrl = await signedUrl("assets", asset.vertical_path, 6 * 3600, undefined, env.mediaMode() !== "mock");
  const basePrompt = job.model_id === scene.model_id && scene.model_prompt ? scene.model_prompt : scene.motion_prompt;
  const appUrl = env.appUrl();
  const webhookUrl = appUrl?.startsWith("https://") ? `${appUrl}/api/webhooks/${model.provider}` : null;
  const adapter = adapterFor(job.provider);
  try {
    const { requestId, body } = await adapter.submit(
      model,
      { imageUrl, prompt: withSuffix(basePrompt), negativePrompt: NEGATIVE_PROMPT, durationSeconds: scene.duration_s },
      { idempotencyKey: job.idempotency_key, webhookUrl },
    );
    const safeBody = { ...body };
    for (const k of Object.keys(safeBody)) if (typeof safeBody[k] === "string" && String(safeBody[k]).includes("token=")) safeBody[k] = "[signed url]";
    await updateJob(job.id, { status: "submitted", provider_request_id: requestId, input: safeBody, submitted_at: now(), error: null });
    await audit(job.project_id, "render-service", "render.submitted", { job: job.id, model: job.model_id, attempt: job.attempt, request: requestId });
  } catch (err) {
    const retryable = err instanceof ProviderError && err.retryable;
    const transient = Number((job.input as { transient_errors?: number }).transient_errors ?? 0) + 1;
    const message = err instanceof Error ? err.message : String(err);
    if (retryable && transient < MAX_TRANSIENT_ERRORS) {
      await updateJob(job.id, { status: "queued", error: message, input: { ...job.input, transient_errors: transient } });
      return;
    }
    await updateJob(job.id, { status: "failed", failure_kind: "provider", error: message.slice(0, 1000), credits_used: 0 });
    await handleJobFailure({ ...job, status: "failed" }, scene, "provider");
  }
}

async function downloadOutput(url: string, headers: Record<string, string>): Promise<Buffer> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > 300 * 1024 * 1024) throw new Error("Output file is too large.");
  return Buffer.from(await res.arrayBuffer());
}

async function pollJob(job: RenderJob, scene: Scene, models: Map<string, RegistryModel>) {
  if (job.last_polled_at && Date.now() - new Date(job.last_polled_at).getTime() < POLL_INTERVAL_MS) return;
  const adapter = adapterFor(job.provider);
  const timedOut = job.submitted_at && Date.now() - new Date(job.submitted_at).getTime() > JOB_TIMEOUT_MS;
  let result;
  try {
    result = await adapter.poll(job.provider_request_id!);
  } catch (err) {
    await updateJob(job.id, { last_polled_at: now(), error: err instanceof Error ? err.message.slice(0, 500) : String(err) });
    if (timedOut) {
      await updateJob(job.id, { status: "failed", failure_kind: "provider", error: "Provider did not finish within 45 minutes." });
      await handleJobFailure(job, scene, "provider");
    }
    return;
  }

  if (result.status === "queued" || result.status === "in_progress") {
    if (timedOut) {
      await adapter.cancel(job.provider_request_id!).catch(() => false);
      await updateJob(job.id, { status: "failed", failure_kind: "provider", error: "Provider did not finish within 45 minutes.", credits_used: job.est_credits });
      await handleJobFailure(job, scene, "provider");
      return;
    }
    await updateJob(job.id, { status: result.status, last_polled_at: now() });
    return;
  }

  if (result.status === "completed") {
    try {
      let clip: Buffer;
      if (job.provider === "mock") {
        const asset = await loadAsset(scene.background_asset_id);
        const model = models.get(job.model_id);
        const seconds = (model && billedDuration(model, scene.duration_s)) || Math.ceil(scene.duration_s);
        clip = await mockClipFromImage(await getObject("assets", asset!.vertical_path!), seconds);
      } else {
        clip = await downloadOutput(result.videoUrl!, adapter.downloadHeaders(result.videoUrl!));
      }
      const clipPath = `clips/${job.project_id}/${scene.id}/${job.id}.mp4`;
      await putObject("media", clipPath, clip, "video/mp4");
      await updateJob(job.id, {
        status: "completed",
        clip_path: clipPath,
        output_url: result.videoUrl ?? null,
        credits_used: result.creditsUsed ?? job.est_credits,
        completed_at: now(),
        last_polled_at: now(),
      });
      await updateScene(scene.id, { render_status: "qa" });
    } catch (err) {
      await updateJob(job.id, { last_polled_at: now(), error: `Saving output failed: ${err instanceof Error ? err.message : err}` });
    }
    return;
  }

  // failed or canceled
  const charged = result.creditsUsed ?? (job.provider === "higgsfield" && job.status === "in_progress" ? job.est_credits : 0);
  await updateJob(job.id, { status: "failed", failure_kind: "provider", error: result.error ?? result.status, credits_used: charged, last_polled_at: now() });
  await handleJobFailure(job, scene, "provider");
}

/** FR-27/FR-28: retry with the fallback on the last attempt, then human review. */
async function handleJobFailure(job: RenderJob, scene: Scene, kind: "provider" | "qa", qaResultId?: string) {
  const reviewerRun = job.initiated_by.startsWith("reviewer");
  const plan =
    reviewerRun || !scene.model_id
      ? null
      : nextAttempt({ attempt: job.attempt, failureKind: kind, failedModel: job.model_id, primary: scene.model_id, fallbacks: scene.fallback_model_ids });
  if (plan) {
    const { models } = await loadRegistry();
    const model = models.find((m) => m.model_id === plan.model && m.enabled && m.status !== "not_usable");
    if (model) {
      const version = await loadVersion(job.storyboard_version_id);
      await createJob({ project: { id: job.project_id }, version, scene, model, attempt: plan.attempt, initiatedBy: "system" });
      await audit(job.project_id, "render-service", "render.retry", { scene: scene.scene_order, attempt: plan.attempt, model: plan.model, after: kind });
      return;
    }
  }
  await updateScene(scene.id, { render_status: "needs_review" });
  if (qaResultId) {
    must(await db().from("qa_results").update({ needs_review: true }).eq("id", qaResultId), "flag qa for review");
  } else {
    must(
      await db().from("qa_results").insert({
        render_job_id: job.id,
        scene_id: scene.id,
        kind: "scene",
        overall: "fail",
        flags: [kind === "provider" ? "provider_failure" : "qa_failure"],
        summary: `Scene ${scene.scene_order} failed after ${job.attempt} attempt(s): ${job.error ?? kind}`.slice(0, 1000),
        needs_review: true,
      }),
      "queue human review",
    );
  }
  await audit(job.project_id, "render-service", "render.to_human_review", { scene: scene.scene_order, attempts: job.attempt, kind });
}

// ------------------------------------------------------------------ scene QA (FR-25, FR-26)

async function runSceneQa(job: RenderJob, scene: Scene) {
  const existing = must(await db().from("qa_results").select("id").eq("render_job_id", job.id).limit(1), "qa exists") as { id: string }[];
  if (existing.length) return;
  const asset = await loadAsset(scene.background_asset_id);
  const source = asset?.vertical_path ? await getObject("assets", asset.vertical_path) : null;
  const clip = await getObject("media", job.clip_path!);

  let probe: Probe | null = null;
  let frames: Buffer[] = [];
  const times: number[] = [];
  const notes: string[] = [];
  await withTempDir(async (dir) => {
    const file = path.join(dir, "clip.mp4");
    await writeFile(file, clip);
    try {
      probe = await probeFile(file);
      const usable = Math.min(scene.duration_s, probe.duration_s);
      times.push(0.05, usable * 0.33, usable * 0.66, Math.max(0.1, usable - 0.15));
      frames = await extractFrames(file, times, dir);
    } catch (err) {
      notes.push(`Frame extraction failed: ${err instanceof Error ? err.message : err}`);
    }
  });

  let pixel: number | null = null;
  if (source && frames[0]) {
    pixel = grayscaleSimilarity(await grayRaster(source), await grayRaster(frames[0]));
  }

  let scores = null;
  if (source && frames.length) {
    try {
      scores = await scoreClip({
        sourceJpegBase64: await toJpegBase64(source, 1024),
        frames: await Promise.all(frames.map(async (f, i) => ({ atSeconds: times[i], jpegBase64: await toJpegBase64(f, 768) }))),
        sceneDescription: `${scene.shot_type}: ${scene.motion_prompt}`,
      });
    } catch (err) {
      notes.push(`Claude scoring failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  const verdict = judgeClip({ scores, pixelSimilarity: pixel, probe, sceneDuration: scene.duration_s });
  const framePaths: string[] = [];
  for (let i = 0; i < frames.length; i++) {
    const p = `qa/${job.id}/frame_${i}.jpg`;
    await putObject("media", p, frames[i], "image/jpeg");
    framePaths.push(p);
  }
  const qa = must(
    await db()
      .from("qa_results")
      .insert({
        render_job_id: job.id,
        scene_id: scene.id,
        kind: "scene",
        automated_scores: { ...(scores ?? {}), pixel_similarity: pixel, probe, frame_times: times, notes },
        flags: verdict.flags,
        fidelity_score: scores ? scores.fidelity : null,
        overall: verdict.overall,
        summary: [scores?.summary, ...verdict.reasons, ...notes].filter(Boolean).join(" ").slice(0, 2000),
        frame_paths: framePaths,
        needs_review: verdict.overall === "borderline",
      })
      .select("id")
      .single(),
    "save qa",
  ) as { id: string };

  if (verdict.overall === "pass") {
    await updateScene(scene.id, { render_status: "passed", clip_path: job.clip_path });
  } else if (verdict.overall === "borderline") {
    await updateScene(scene.id, { render_status: "needs_review" });
  } else {
    await updateJob(job.id, { failure_kind: "qa", error: verdict.reasons.join(" ").slice(0, 1000) });
    await handleJobFailure({ ...job, error: verdict.reasons.join(" ") }, scene, "qa", qa.id);
  }
  await audit(job.project_id, "qa-service", "qa.scene", { scene: scene.scene_order, attempt: job.attempt, overall: verdict.overall, flags: verdict.flags });
}

// ------------------------------------------------------------------ assembly (FR-23, FR-24)

function pickMusic(mood: string): string | null {
  const tracks = env.musicTracks();
  if (!tracks.length) return null;
  const words = mood.toLowerCase().split(/\W+/);
  return (tracks.find((t) => words.includes(t.mood.toLowerCase())) ?? tracks[0]).url;
}

async function ensureVoiceovers(projectId: string, scenes: Scene[]): Promise<Map<string, { path: string; seconds: number | null }>> {
  const out = new Map<string, { path: string; seconds: number | null }>();
  // Without an ElevenLabs key the video is made without voiceover (text and
  // music still go in) rather than stalling; the Render panel says so.
  if (env.mediaMode() !== "mock" && !env.elevenLabsApiKey()) return out;
  for (const s of scenes) {
    if (!s.voiceover.trim()) continue;
    const key = fnv1a(`${s.voiceover.trim()}|${env.elevenLabsVoiceId()}|${env.elevenLabsModelId()}|${env.mediaMode()}`);
    const p = `voice/${projectId}/${key}.mp3`;
    let seconds: number | null = null;
    if (s.voiceover_key === key && s.voiceover_path) {
      seconds = await audioDuration(await getObject("media", s.voiceover_path)).catch(() => null);
    } else {
      const existing = await getObject("media", p).catch(() => null);
      if (existing) {
        seconds = await audioDuration(existing).catch(() => null);
      } else {
        const vo = await synthesizeVoiceover(s.voiceover.trim());
        await putObject("media", p, vo.audio, "audio/mpeg");
        seconds = vo.seconds;
      }
      await updateScene(s.id, { voiceover_path: p, voiceover_key: key });
    }
    out.set(s.id, { path: p, seconds });
  }
  return out;
}

async function assemble(project: Project, version: StoryboardVersion, scenes: Scene[], attempt: number) {
  const business = must(await db().from("business_profiles").select("*").eq("id", project.business_id).single(), "load profile") as BusinessProfile;
  const voice = await ensureVoiceovers(project.id, scenes);
  const assets = must(
    await db().from("assets").select("id, vertical_path").in("id", scenes.map((s) => s.background_asset_id).filter(Boolean) as string[]),
    "load scene assets",
  ) as { id: string; vertical_path: string }[];
  const assetPath = new Map(assets.map((a) => [a.id, a.vertical_path]));
  const ttl = 12 * 3600;
  const live = env.mediaMode() !== "mock";
  const mediaUrls = await signedUrls("media", [...scenes.map((s) => s.clip_path ?? ""), ...[...voice.values()].map((v) => v.path)], ttl, live);
  const assetUrls = await signedUrls("assets", [...assetPath.values(), business.logo_path ?? ""], ttl, live);

  await setVersionState(version, "qa");

  if (env.mediaMode() === "mock") {
    const parts = [];
    for (const s of scenes) {
      const isClip = s.treatment === "animate" && s.clip_path;
      parts.push({
        kind: (isClip ? "video" : "image") as "video" | "image",
        data: isClip ? await getObject("media", s.clip_path!) : await getObject("assets", assetPath.get(s.background_asset_id!)!),
        seconds: s.duration_s,
      });
    }
    const file = await mockAssemble(parts);
    const id = randomUUID();
    const filePath = `finals/${project.id}/${id}.mp4`;
    await putObject("media", filePath, file, "video/mp4");
    const final = must(
      await db()
        .from("final_videos")
        .insert({ id, project_id: project.id, storyboard_version_id: version.id, status: "qa", file_path: filePath, assembly_render_id: "mock", assembly_attempt: attempt })
        .select("*")
        .single(),
      "save mock final",
    ) as FinalVideo;
    await runFinalQa(final, project, version, scenes);
    return;
  }

  const brand = Array.isArray(business.brand_colors) ? business.brand_colors : [];
  const edit = buildTimeline({
    scenes: scenes.map((s) => ({
      order: s.scene_order,
      role: s.role,
      duration_s: s.duration_s,
      treatment: s.treatment,
      visualUrl:
        s.treatment === "animate" && s.clip_path
          ? mediaUrls.get(s.clip_path)!
          : assetUrls.get(assetPath.get(s.background_asset_id ?? "") ?? "")!,
      stillEffect: s.still_motion_effect,
      onScreenText: s.on_screen_text,
      voiceoverText: s.voiceover,
      voiceoverUrl: voice.get(s.id) ? (mediaUrls.get(voice.get(s.id)!.path) ?? null) : null,
      voiceoverSeconds: voice.get(s.id)?.seconds ?? null,
    })),
    businessName: business.name,
    bookingText: business.booking_link.replace(/^https?:\/\//, "").replace(/\/$/, ""),
    brandPrimary: brand[0] ?? "#111111",
    brandAccent: brand[1] ?? "#F5C518",
    logoUrl: business.logo_path ? (assetUrls.get(business.logo_path) ?? null) : null,
    musicUrl: pickMusic(version.music_mood),
    captions: true,
    fontFamily: env.shotstackFont(),
    callbackUrl: env.appUrl()?.startsWith("https://") ? `${env.appUrl()}/api/webhooks/shotstack` : null,
  });
  const renderId = await submitRender(edit);
  must(
    await db().from("final_videos").insert({
      project_id: project.id,
      storyboard_version_id: version.id,
      status: "assembling",
      assembly_render_id: renderId,
      assembly_attempt: attempt,
    }),
    "save final",
  );
  await audit(project.id, "assembly-service", "assembly.submitted", { version: version.version, render: renderId, attempt });
}

async function pollAssembly(final: FinalVideo, project: Project, version: StoryboardVersion, scenes: Scene[]) {
  if (Date.now() - new Date(final.updated_at).getTime() < POLL_INTERVAL_MS) return;
  const status = await renderStatus(final.assembly_render_id!);
  if (status.status === "done" && status.url) {
    const file = await downloadOutput(status.url, {});
    const filePath = `finals/${project.id}/${final.id}.mp4`;
    await putObject("media", filePath, file, "video/mp4");
    must(await db().from("final_videos").update({ status: "qa", file_path: filePath, updated_at: now() }).eq("id", final.id), "save final file");
    await runFinalQa({ ...final, status: "qa", file_path: filePath }, project, version, scenes);
  } else if (status.status === "failed") {
    must(await db().from("final_videos").update({ status: "failed", error: status.error ?? "Assembly failed", updated_at: now() }).eq("id", final.id), "final failed");
    await retryOrReviewFinal(final, project, version, scenes, status.error ?? "Assembly failed");
  } else {
    must(await db().from("final_videos").update({ updated_at: now() }).eq("id", final.id), "touch final");
  }
}

async function retryOrReviewFinal(final: FinalVideo, project: Project, version: StoryboardVersion, scenes: Scene[], reason: string, qaId?: string) {
  if (final.assembly_attempt < MAX_ASSEMBLY_ATTEMPTS) {
    await assemble(project, version, scenes, final.assembly_attempt + 1);
    return;
  }
  must(await db().from("final_videos").update({ status: "needs_review", updated_at: now() }).eq("id", final.id), "final review");
  if (qaId) must(await db().from("qa_results").update({ needs_review: true }).eq("id", qaId), "flag final qa");
  else {
    must(
      await db().from("qa_results").insert({ final_video_id: final.id, kind: "final", overall: "fail", summary: reason.slice(0, 1000), needs_review: true }),
      "queue final review",
    );
  }
}

/** Final checks: duration, 1080x1920, audio present and level (FR-25), before the dashboard (FR-29). */
async function runFinalQa(final: FinalVideo, project: Project, version: StoryboardVersion, scenes: Scene[]) {
  const file = await getObject("media", final.file_path!);
  const expected = totalRuntime(scenes);
  const voiceoverMade = !!env.elevenLabsApiKey() && scenes.some((s) => s.voiceover.trim());
  const expectAudio = voiceoverMade || env.musicTracks().length > 0 || env.mediaMode() === "mock";
  let probe = null;
  let posterPath: string | null = null;
  await withTempDir(async (dir) => {
    const f = path.join(dir, "final.mp4");
    await writeFile(f, file);
    try {
      const p = await probeFile(f);
      const vol = p.has_audio ? await volumeStats(f) : { mean: null, max: null };
      probe = { ...p, mean_volume_db: vol.mean, max_volume_db: vol.max };
      const [poster] = await extractFrames(f, [Math.min(1, p.duration_s / 2)], dir);
      posterPath = `finals/${project.id}/${final.id}.jpg`;
      await putObject("media", posterPath, poster, "image/jpeg");
    } catch (err) {
      console.warn("[qa] final probe failed", err);
    }
  });
  const verdict = judgeFinal(probe, expected, expectAudio);
  const qa = must(
    await db()
      .from("qa_results")
      .insert({
        final_video_id: final.id,
        kind: "final",
        automated_scores: { probe, expected_seconds: expected },
        flags: verdict.flags,
        overall: verdict.overall,
        summary: verdict.reasons.join(" ") || "All final checks passed.",
        needs_review: verdict.overall === "borderline",
      })
      .select("id")
      .single(),
    "save final qa",
  ) as { id: string };
  const duration = (probe as { duration_s: number } | null)?.duration_s ?? null;

  if (verdict.overall === "pass") {
    must(
      await db().from("final_videos").update({ status: "passed", qa: verdict, duration_s: duration, poster_path: posterPath, updated_at: now() }).eq("id", final.id),
      "final passed",
    );
    await setVersionState(version, "complete");
    await audit(project.id, "qa-service", "video.delivered", { final: final.id, version: version.version });
  } else if (verdict.overall === "borderline") {
    must(
      await db().from("final_videos").update({ status: "needs_review", qa: verdict, duration_s: duration, poster_path: posterPath, updated_at: now() }).eq("id", final.id),
      "final borderline",
    );
  } else {
    must(await db().from("final_videos").update({ status: "failed", qa: verdict, poster_path: posterPath, updated_at: now() }).eq("id", final.id), "final failed");
    await retryOrReviewFinal(final, project, version, scenes, verdict.reasons.join(" "), qa.id);
  }
}

// ------------------------------------------------------------------ the tick

export async function syncProjectStatus(projectId: string): Promise<ProjectStatus> {
  const project = must(await db().from("projects").select("*").eq("id", projectId).single(), "load project") as Project;
  if (!project.current_version_id) return project.status;
  const version = await loadVersion(project.current_version_id);
  let status: ProjectStatus = project.status;
  if (version.state === "complete") status = "complete";
  else if (version.state === "failed") status = "failed";
  else if (["approved", "rendering", "qa"].includes(version.state)) {
    const [scenes, blocked, finals] = await Promise.all([
      loadScenes(version.id),
      db().from("render_jobs").select("id", { count: "exact", head: true }).eq("storyboard_version_id", version.id).eq("status", "blocked"),
      db().from("final_videos").select("status").eq("storyboard_version_id", version.id).order("created_at", { ascending: false }).limit(1),
    ]);
    const latestFinal = (finals.data?.[0] as { status: string } | undefined)?.status;
    if (scenes.some((s) => s.render_status === "needs_review") || (blocked.count ?? 0) > 0 || latestFinal === "needs_review") status = "needs_review";
    else if (version.state === "qa") status = "qa";
    else if (version.state === "rendering") status = "rendering";
    else status = "approved";
  } else {
    status = project.brief ? "storyboard" : "brief";
  }
  if (status !== project.status) {
    must(await db().from("projects").update({ status, updated_at: now() }).eq("id", projectId), "project status");
  }
  return status;
}

/**
 * Advance one project as far as it can go right now. Safe to call from page
 * polling, webhooks and the cron at the same time: a database lock lets only
 * one caller work on a project.
 */
export async function advanceProject(projectId: string, budgetMs = 240_000): Promise<"busy" | "idle" | "advanced"> {
  const locked = must(await db().rpc("try_lock_project", { p_project_id: projectId, p_seconds: Math.ceil(budgetMs / 1000) + 30 }), "lock") as boolean;
  if (!locked) return "busy";
  const started = Date.now();
  const timeLeft = () => budgetMs - (Date.now() - started);
  try {
    const project = must(await db().from("projects").select("*").eq("id", projectId).single(), "load project") as Project;
    if (!project.current_version_id) return "idle";
    const version = await loadVersion(project.current_version_id);
    if (!["approved", "rendering", "qa"].includes(version.state)) return "idle";

    const [{ models }, scenesInit] = await Promise.all([loadRegistry(), loadScenes(version.id)]);
    const modelMap = new Map(models.map((m) => [m.model_id, m]));
    let scenes = scenesInit;
    const sceneById = () => new Map(scenes.map((s) => [s.id, s]));

    const loadJobs = async () =>
      must(await db().from("render_jobs").select("*").eq("storyboard_version_id", version.id).order("created_at"), "load jobs") as RenderJob[];

    // 0. Self-heal: create missing first jobs, and requeue jobs stuck mid-submit
    //    (the provider dedupes the retry by idempotency key).
    if (version.state === "approved" || version.state === "rendering") await ensureSceneJobs(project, version);
    if (version.state === "approved") await setVersionState(version, "rendering");
    const stuckBefore = new Date(Date.now() - 3 * 60_000).toISOString();
    await db().from("render_jobs").update({ status: "queued", updated_at: now() }).eq("storyboard_version_id", version.id).eq("status", "submitting").lt("updated_at", stuckBefore);

    // 1. Submit queued jobs through the gate and credit cap.
    for (const job of (await loadJobs()).filter((j) => j.status === "queued")) {
      if (timeLeft() < 30_000) break;
      const scene = sceneById().get(job.scene_id);
      if (scene) await submitJob(job, scene, modelMap);
    }
    // 2. Poll in-flight jobs.
    for (const job of (await loadJobs()).filter((j) => ["submitted", "in_progress", "completed"].includes(j.status) && !(j.status === "completed" && j.clip_path))) {
      if (timeLeft() < 30_000) break;
      const scene = sceneById().get(job.scene_id);
      if (scene) await pollJob(job, scene, modelMap);
    }
    // 3. QA finished clips.
    scenes = await loadScenes(version.id);
    let qaRuns = 0;
    for (const job of (await loadJobs()).filter((j) => j.status === "completed" && j.clip_path)) {
      const scene = sceneById().get(job.scene_id);
      if (!scene || scene.render_status !== "qa") continue;
      if (qaRuns >= MAX_QA_PER_TICK || timeLeft() < 90_000) break;
      const latest = (await loadJobs()).filter((j) => j.scene_id === scene.id).sort((a, b) => b.attempt - a.attempt)[0];
      if (latest.id !== job.id) continue;
      await runSceneQa(job, scene);
      qaRuns++;
    }

    // 4. Assemble once every animated scene has an accepted clip.
    scenes = await loadScenes(version.id);
    const allReady = scenes.every((s) => s.treatment !== "animate" || (s.render_status === "passed" && s.clip_path));
    if (allReady && timeLeft() > 60_000) {
      const finals = must(
        await db().from("final_videos").select("*").eq("storyboard_version_id", version.id).order("created_at", { ascending: false }).limit(1),
        "load finals",
      ) as FinalVideo[];
      const latest = finals[0];
      if (!latest) await assemble(project, version, scenes, 1);
      else if (latest.status === "assembling") await pollAssembly(latest, project, version, scenes);
      else if (latest.status === "qa" && latest.file_path) await runFinalQa(latest, project, version, scenes);
    }
    await syncProjectStatus(projectId);
    return "advanced";
  } finally {
    await db().rpc("unlock_project", { p_project_id: projectId });
  }
}

/** Cron sweep: advance every project with work in flight. */
export async function advanceAll(budgetMs = 270_000) {
  const started = Date.now();
  const rows = must(
    await db().from("projects").select("id").in("status", ["approved", "rendering", "qa", "needs_review"]).order("updated_at").limit(50),
    "active projects",
  ) as { id: string }[];
  const results: Record<string, string> = {};
  for (const r of rows) {
    const left = budgetMs - (Date.now() - started);
    if (left < 60_000) break;
    try {
      results[r.id] = await advanceProject(r.id, Math.min(left - 10_000, 120_000));
    } catch (err) {
      results[r.id] = `error: ${err instanceof Error ? err.message : err}`;
    }
  }
  return results;
}

export async function nudgeByProviderRequest(requestId: string): Promise<string | null> {
  const job = must(await db().from("render_jobs").select("project_id").eq("provider_request_id", requestId).maybeSingle(), "find job") as { project_id: string } | null;
  return job?.project_id ?? null;
}

export async function nudgeByAssembly(renderId: string): Promise<string | null> {
  const f = must(await db().from("final_videos").select("project_id").eq("assembly_render_id", renderId).maybeSingle(), "find final") as { project_id: string } | null;
  return f?.project_id ?? null;
}

export { assemble, handleJobFailure, runFinalQa };
