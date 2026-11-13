import "server-only";
import { BriefSchema, type Brief, type SceneDraft } from "../../core/schemas";
import { unsupportedClaims } from "../../core/facts";
import { libraryReadiness } from "../../core/library";
import { byQuality, hardCandidates, type RegistryModel } from "../../core/routing-rules";
import { estimateSceneCredits, normalizeScenes, renderKey, totalRuntime, validateStoryboard } from "../../core/storyboard-rules";
import { canTransition, type VersionState } from "../../core/pipeline-rules";
import type { Asset, BusinessProfile, Project, Scene, StoryboardVersion } from "../../types";
import { improvePrompt } from "../ai/brief";
import { routeScenes } from "../ai/router";
import { draftStoryboard as aiDraft, reviseStoryboard as aiRevise } from "../ai/storyboard";
import { audit } from "../audit";
import { badRequest, conflict, HttpError, notFound } from "../http";
import { db, must } from "../db";
import { listAssets } from "./assets";
import { loadPins, loadRegistry } from "./registry";

// ------------------------------------------------------------------ loading

export async function loadProject(business: BusinessProfile, projectId: string): Promise<Project> {
  const p = must(
    await db().from("projects").select("*").eq("id", projectId).eq("business_id", business.id).maybeSingle(),
    "load project",
  ) as Project | null;
  if (!p) throw notFound("Project not found.");
  return p;
}

export async function loadVersion(versionId: string): Promise<StoryboardVersion> {
  return must(await db().from("storyboard_versions").select("*").eq("id", versionId).single(), "load version") as StoryboardVersion;
}

export async function loadScenes(versionId: string): Promise<Scene[]> {
  const rows = must(
    await db().from("scenes").select("*").eq("storyboard_version_id", versionId).order("scene_order"),
    "load scenes",
  ) as Scene[];
  return rows.map((s) => ({ ...s, duration_s: Number(s.duration_s), est_credits: Number(s.est_credits) }));
}

function sceneToDraft(s: Scene): SceneDraft {
  return {
    order: s.scene_order,
    role: s.role,
    duration_s: Number(s.duration_s),
    background_asset_id: s.background_asset_id ?? "",
    treatment: s.treatment,
    shot_type: s.shot_type as SceneDraft["shot_type"],
    motion_prompt: s.motion_prompt,
    subject_description: s.subject_description,
    still_motion_effect: (s.still_motion_effect as SceneDraft["still_motion_effect"]) ?? null,
    voiceover: s.voiceover,
    on_screen_text: s.on_screen_text,
  };
}

function sources(project: Pick<Project, "original_prompt" | "clarifying_answer">, profile: BusinessProfile): string[] {
  return [
    project.original_prompt,
    project.clarifying_answer ?? "",
    profile.name,
    profile.address,
    profile.booking_link,
    profile.extra_facts,
    ...(profile.services ?? []).map((s) => `${s.name} ${s.price} ${s.notes ?? ""}`),
  ];
}

function briefWarnings(brief: Brief, srcs: string[]): string[] {
  const text = [brief.offer, brief.hook_idea, brief.call_to_action, ...brief.must_include_facts].join(" \n ");
  const bad = unsupportedClaims(text, srcs);
  return bad.length
    ? [`Check these details. They are not in your prompt or profile: ${bad.join(", ")}. Edit the brief if they are wrong.`]
    : [];
}

// ------------------------------------------------------------------ brief (FR-5)

export async function createProject(business: BusinessProfile, prompt: string): Promise<Project> {
  const clean = prompt.trim();
  if (clean.length < 3) throw badRequest("Describe the video in a few words.");
  if (clean.length > 1000) throw badRequest("Keep the request under 1000 characters.");
  const assets = await listAssets(business.id);
  const readiness = libraryReadiness(assets);
  if (!readiness.ready) {
    throw new HttpError(409, `Your photo library needs ${readiness.missing.join(" and ")} before making videos.`);
  }
  const result = await improvePrompt({ prompt: clean, profile: business, assets, allowQuestion: true });
  const project = must(
    await db()
      .from("projects")
      .insert({
        business_id: business.id,
        title: result.brief.title.slice(0, 120),
        original_prompt: clean,
        brief: result.brief,
        brief_warnings: briefWarnings(result.brief, sources({ original_prompt: clean, clarifying_answer: null }, business)),
        clarifying_question: result.clarifying_question,
        status: "brief",
        credit_cap: business.credit_cap_default,
      })
      .select("*")
      .single(),
    "create project",
  ) as Project;
  await audit(project.id, business.owner_id, "brief.created", { prompt: clean, question: result.clarifying_question });
  return project;
}

/** The single clarifying question (PRD 6.1). Answering re-runs the brief once; no further questions. */
export async function answerClarification(business: BusinessProfile, project: Project, answer: string): Promise<Project> {
  if (!project.clarifying_question) throw badRequest("There is no open question.");
  if (project.status !== "brief") throw conflict("The brief is already locked into a storyboard.");
  const assets = await listAssets(business.id);
  const clean = answer.trim().slice(0, 500);
  const result = await improvePrompt({
    prompt: project.original_prompt,
    profile: business,
    assets,
    previousQuestion: project.clarifying_question,
    clarifyingAnswer: clean || "(owner skipped the question)",
    allowQuestion: false,
  });
  const updated = must(
    await db()
      .from("projects")
      .update({
        brief: result.brief,
        title: result.brief.title.slice(0, 120),
        clarifying_answer: clean || "(skipped)",
        brief_warnings: briefWarnings(result.brief, sources({ ...project, clarifying_answer: clean }, business)),
        updated_at: new Date().toISOString(),
      })
      .eq("id", project.id)
      .select("*")
      .single(),
    "save clarified brief",
  ) as Project;
  await audit(project.id, business.owner_id, "brief.clarified", { answer: clean });
  return updated;
}

/** Owner edits to the brief are the owner's own facts, so no claim warnings are added. */
export async function updateBrief(business: BusinessProfile, project: Project, brief: unknown): Promise<Project> {
  const parsed = BriefSchema.safeParse(brief);
  if (!parsed.success) throw badRequest("The brief is missing fields.", parsed.error.issues);
  const updated = must(
    await db()
      .from("projects")
      .update({ brief: parsed.data, title: parsed.data.title.slice(0, 120), brief_warnings: [], updated_at: new Date().toISOString() })
      .eq("id", project.id)
      .select("*")
      .single(),
    "update brief",
  ) as Project;
  await audit(project.id, business.owner_id, "brief.edited", {});
  return updated;
}

// ------------------------------------------------------------------ versions + routing

async function nextVersionNumber(projectId: string): Promise<number> {
  const row = must(
    await db().from("storyboard_versions").select("version").eq("project_id", projectId).order("version", { ascending: false }).limit(1).maybeSingle(),
    "version number",
  ) as { version: number } | null;
  return (row?.version ?? 0) + 1;
}

interface CreateVersionInput {
  project: Project;
  business: BusinessProfile;
  assets: Asset[];
  scenes: SceneDraft[];
  parent: StoryboardVersion | null;
  source: "generated" | "chat" | "inline";
  changeNote: string;
  musicMood: string;
  rationale: string;
  warnings: string[];
  actor: string;
}

async function createVersion(input: CreateVersionInput): Promise<StoryboardVersion> {
  const { project } = input;
  const scenes = normalizeScenes(input.scenes);
  const version = await nextVersionNumber(project.id);
  const v = must(
    await db()
      .from("storyboard_versions")
      .insert({
        project_id: project.id,
        version,
        state: input.parent ? "revised" : "draft",
        parent_version_id: input.parent?.id ?? null,
        source: input.source,
        change_note: input.changeNote.slice(0, 500),
        music_mood: input.musicMood.slice(0, 200),
        rationale: input.rationale.slice(0, 1000),
        total_runtime_s: totalRuntime(scenes),
        validation_warnings: input.warnings,
      })
      .select("*")
      .single(),
    "create version",
  ) as StoryboardVersion;

  must(
    await db()
      .from("scenes")
      .insert(
        scenes.map((s) => ({
          storyboard_version_id: v.id,
          scene_order: s.order,
          role: s.role,
          duration_s: s.duration_s,
          background_asset_id: s.background_asset_id || null,
          treatment: s.treatment,
          shot_type: s.shot_type,
          motion_prompt: s.motion_prompt,
          subject_description: s.subject_description,
          still_motion_effect: s.still_motion_effect,
          voiceover: s.voiceover,
          on_screen_text: s.on_screen_text,
          render_key: renderKey(s),
          render_status: s.treatment === "animate" ? "pending" : "not_needed",
        })),
      ),
    "insert scenes",
  );

  await routeVersion(v, input.parent, input.assets, project.brief!);
  must(
    await db().from("projects").update({ current_version_id: v.id, status: "storyboard", updated_at: new Date().toISOString() }).eq("id", project.id),
    "set current version",
  );
  await audit(project.id, input.actor, "storyboard.version_created", { version, source: input.source, note: input.changeNote });
  return loadVersion(v.id);
}

/**
 * FR-12..FR-16: route animated scenes. Unchanged scenes reuse the parent's
 * decision, ops pins win, everything else goes to Claude. Every decision is
 * logged with the registry version.
 */
async function routeVersion(version: StoryboardVersion, parent: StoryboardVersion | null, assets: Asset[], brief: Brief) {
  const [{ models, version: registryVersion }, pins, scenes] = await Promise.all([loadRegistry(), loadPins(), loadScenes(version.id)]);
  const byId = new Map(models.map((m) => [m.model_id, m]));
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const parentScenes = parent ? await loadScenes(parent.id) : [];
  const parentByKey = new Map(parentScenes.filter((s) => s.treatment === "animate" && s.model_id).map((s) => [s.render_key, s]));

  type Decision = {
    scene: Scene;
    model_id: string | null;
    fallback: string[];
    reason: string;
    confidence: "high" | "medium" | "low" | "none";
    model_prompt: string | null;
    source: "claude" | "pin" | "reused";
    flagged: boolean;
    flag_reason: string | null;
    attempts: number;
  };
  const decisions: Decision[] = [];
  const toClaude: Scene[] = [];

  for (const s of scenes.filter((x) => x.treatment === "animate")) {
    const candidates = hardCandidates({ order: s.scene_order, duration_s: s.duration_s, treatment: s.treatment, shot_type: s.shot_type }, models);
    const candidateIds = new Set(candidates.map((c) => c.model_id));
    const prev = parentByKey.get(s.render_key);
    if (prev?.model_id && candidateIds.has(prev.model_id)) {
      decisions.push({
        scene: s,
        model_id: prev.model_id,
        fallback: prev.fallback_model_ids.filter((f) => candidateIds.has(f)),
        reason: "Scene unchanged from the previous version; previous routing kept.",
        confidence: "high",
        model_prompt: prev.model_prompt,
        source: "reused",
        flagged: false,
        flag_reason: null,
        attempts: 0,
      });
      continue;
    }
    const pinned = pins.get(s.shot_type);
    if (pinned && candidateIds.has(pinned)) {
      const fb = candidates.filter((c) => c.model_id !== pinned).sort(byQuality);
      decisions.push({
        scene: s,
        model_id: pinned,
        fallback: fb.slice(0, 1).map((m) => m.model_id),
        reason: `Ops pinned ${byId.get(pinned)?.display_name ?? pinned} for ${s.shot_type} shots.`,
        confidence: "high",
        model_prompt: null,
        source: "pin",
        flagged: false,
        flag_reason: null,
        attempts: 0,
      });
      continue;
    }
    toClaude.push(s);
  }

  if (toClaude.length) {
    const routed = await routeScenes({
      brief,
      models,
      scenes: toClaude.map((s) => ({
        order: s.scene_order,
        duration_s: s.duration_s,
        shot_type: s.shot_type,
        motion_prompt: s.motion_prompt,
        subject_description: s.subject_description,
        asset: s.background_asset_id ? (assetById.get(s.background_asset_id) ?? null) : null,
      })),
    });
    for (const r of routed) {
      const scene = toClaude.find((s) => s.scene_order === r.order)!;
      decisions.push({ scene, ...r, source: "claude" });
    }
  }

  for (const d of decisions) {
    const model: RegistryModel | undefined = d.model_id ? byId.get(d.model_id) : undefined;
    const est = estimateSceneCredits(model, d.scene.duration_s, "animate");
    must(
      await db()
        .from("scenes")
        .update({
          model_id: d.model_id,
          fallback_model_ids: d.fallback,
          model_prompt: d.model_prompt,
          est_credits: est,
          route_flag: d.model_id ? (d.flagged ? d.flag_reason : null) : (d.flag_reason ?? "no_usable_model"),
        })
        .eq("id", d.scene.id),
      "save routing",
    );
    must(
      await db().from("router_decisions").insert({
        scene_id: d.scene.id,
        storyboard_version_id: version.id,
        model_id: d.model_id,
        reason: d.reason,
        fallback: d.fallback,
        confidence: d.confidence,
        registry_version: registryVersion,
        source: d.source,
        flagged: d.flagged,
        flag_reason: d.flag_reason,
        attempts: d.attempts,
      }),
      "log router decision",
    );
  }

  const total = decisions.reduce(
    (sum, d) => sum + estimateSceneCredits(d.model_id ? byId.get(d.model_id) : undefined, d.scene.duration_s, "animate"),
    0,
  );
  must(
    await db().from("storyboard_versions").update({ est_credits: Math.round(total * 100) / 100, registry_version: registryVersion }).eq("id", version.id),
    "save estimate",
  );
}

// ------------------------------------------------------------------ storyboard (FR-6, FR-8)

function assertEditable(project: Project) {
  if (!project.brief) throw conflict("Write the brief first.");
  if (["rendering", "qa"].includes(project.status)) {
    throw conflict("This video is rendering. Wait for it to finish before editing.");
  }
}

export async function generateStoryboard(business: BusinessProfile, project: Project): Promise<StoryboardVersion> {
  assertEditable(project);
  if (project.current_version_id) throw conflict("A storyboard already exists. Revise it instead.");
  const assets = await listAssets(business.id);
  const out = await aiDraft({ brief: project.brief!, profile: business, assets });
  return createVersion({
    project,
    business,
    assets,
    scenes: out.scenes,
    parent: null,
    source: "generated",
    changeNote: "First draft",
    musicMood: out.result.music_mood,
    rationale: out.result.rationale,
    warnings: out.warnings,
    actor: business.owner_id,
  });
}

export async function reviseByChat(business: BusinessProfile, project: Project, message: string): Promise<StoryboardVersion> {
  assertEditable(project);
  const clean = message.trim();
  if (!clean) throw badRequest("Tell me what to change.");
  if (!project.current_version_id) throw conflict("There is no storyboard yet.");
  const current = await loadVersion(project.current_version_id);
  const scenes = await loadScenes(current.id);
  const assets = await listAssets(business.id);
  const out = await aiRevise({
    brief: project.brief!,
    profile: business,
    assets,
    current: scenes.map(sceneToDraft),
    musicMood: current.music_mood,
    message: clean.slice(0, 1500),
  });
  return createVersion({
    project,
    business,
    assets,
    scenes: out.scenes,
    parent: current,
    source: "chat",
    changeNote: out.result.change_summary,
    musicMood: out.result.music_mood,
    rationale: current.rationale,
    warnings: out.warnings,
    actor: business.owner_id,
  });
}

/** Direct edits to any line. Validated in code, no Claude call needed. */
export async function reviseInline(business: BusinessProfile, project: Project, edited: SceneDraft[], note: string): Promise<StoryboardVersion> {
  assertEditable(project);
  if (!project.current_version_id) throw conflict("There is no storyboard yet.");
  const current = await loadVersion(project.current_version_id);
  const assets = await listAssets(business.id);
  const lib = new Map(
    assets.filter((a) => a.tag_status === "tagged").map((a) => [a.id, { id: a.id, usable: a.usable, area: a.area, faces_visible: a.faces_visible }]),
  );
  const scenes = normalizeScenes(edited);
  const { errors, warnings } = validateStoryboard(scenes, lib, { offer: project.brief?.offer });
  if (errors.length) throw badRequest(errors.join(" "), { errors });
  return createVersion({
    project,
    business,
    assets,
    scenes,
    parent: current,
    source: "inline",
    changeNote: note || "Edited directly",
    musicMood: current.music_mood,
    rationale: current.rationale,
    warnings,
    actor: business.owner_id,
  });
}

// ------------------------------------------------------------------ approval (FR-18, FR-19)

export interface ApprovalCheck {
  ok: boolean;
  blockers: string[];
}

export function approvalBlockers(version: StoryboardVersion, scenes: Scene[], assetIds: Set<string>): ApprovalCheck {
  const blockers: string[] = [];
  if (!["draft", "revised"].includes(version.state)) blockers.push(`Version ${version.version} is ${version.state}.`);
  for (const s of scenes) {
    if (!s.background_asset_id || !assetIds.has(s.background_asset_id)) blockers.push(`Scene ${s.scene_order} has no background photo.`);
    if (s.treatment === "animate" && !s.model_id) {
      blockers.push(`Scene ${s.scene_order}: no AI model fits this scene. Switch it to photo motion or ask Rample ops.`);
    }
  }
  return { ok: blockers.length === 0, blockers };
}

export async function approveVersion(business: BusinessProfile, project: Project, versionId: string, userId: string): Promise<StoryboardVersion> {
  if (project.current_version_id !== versionId) throw conflict("Only the latest storyboard version can be approved.");
  const version = await loadVersion(versionId);
  if (!canTransition(version.state as VersionState, "approved")) throw conflict(`Version is ${version.state}.`);
  const [scenes, assets] = await Promise.all([loadScenes(versionId), listAssets(business.id)]);
  const check = approvalBlockers(version, scenes, new Set(assets.map((a) => a.id)));
  if (!check.ok) throw badRequest(check.blockers.join(" "), { blockers: check.blockers });

  const updated = must(
    await db()
      .from("storyboard_versions")
      .update({ state: "approved", approved_by: userId, approved_at: new Date().toISOString() })
      .eq("id", versionId)
      .in("state", ["draft", "revised"])
      .select("*")
      .single(),
    "approve version",
  ) as StoryboardVersion;
  must(await db().from("projects").update({ status: "approved", updated_at: new Date().toISOString() }).eq("id", project.id), "project approved");
  await audit(project.id, userId, "storyboard.approved", { version: version.version, est_credits: version.est_credits });
  return updated;
}

export async function setCreditCap(project: Project, cap: number, actor: string) {
  if (!Number.isFinite(cap) || cap < 1 || cap > 100000) throw badRequest("Enter a credit cap between 1 and 100000.");
  must(await db().from("projects").update({ credit_cap: Math.round(cap) }).eq("id", project.id), "update cap");
  // Jobs blocked by the old cap get another chance.
  must(
    await db().from("render_jobs").update({ status: "queued", failure_kind: null, error: null }).eq("project_id", project.id).eq("status", "blocked").eq("failure_kind", "cap"),
    "unblock jobs",
  );
  await audit(project.id, actor, "project.credit_cap", { cap });
}

export { sceneToDraft };
