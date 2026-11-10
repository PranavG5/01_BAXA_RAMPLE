import "server-only";
import type { Asset, BusinessProfile, FinalVideo, Project, QaResult, RenderJob, RouterDecisionRow, Scene, StoryboardVersion } from "../../types";
import { signedUrls } from "../storage";
import { db, must } from "../supabase";
import { approvalBlockers, loadScenes } from "./projects";
import { loadRegistry } from "./registry";

export interface SceneView extends Scene {
  photo_thumb_url: string | null;
  photo_url: string | null;
  clip_url: string | null;
  model_name: string | null;
  decision: Pick<RouterDecisionRow, "reason" | "confidence" | "source" | "flagged" | "flag_reason"> | null;
  jobs: Pick<RenderJob, "id" | "attempt" | "status" | "model_id" | "error" | "credits_used" | "est_credits" | "failure_kind" | "created_at">[];
  latest_qa: Pick<QaResult, "overall" | "flags" | "summary" | "needs_review" | "decision"> | null;
}

export interface FinalView extends FinalVideo {
  video_url: string | null;
  poster_url: string | null;
}

export interface ProjectSnapshot {
  project: Project;
  versions: Pick<StoryboardVersion, "id" | "version" | "state" | "source" | "change_note" | "created_at" | "approved_at" | "est_credits" | "total_runtime_s">[];
  version: StoryboardVersion | null;
  scenes: SceneView[];
  finals: FinalView[];
  blockers: string[];
  credits: { estimated: number; committed: number; cap: number; blockedByCap: boolean };
  modelNames: Record<string, string>;
}

export async function projectSnapshot(business: BusinessProfile, project: Project, opts: { versionId?: string } = {}): Promise<ProjectSnapshot> {
  const versions = must(
    await db()
      .from("storyboard_versions")
      .select("id, version, state, source, change_note, created_at, approved_at, est_credits, total_runtime_s")
      .eq("project_id", project.id)
      .order("version", { ascending: false }),
    "versions",
  ) as ProjectSnapshot["versions"];
  const versionId = opts.versionId && versions.some((v) => v.id === opts.versionId) ? opts.versionId : project.current_version_id;
  const version = versionId
    ? (must(await db().from("storyboard_versions").select("*").eq("id", versionId).single(), "version") as StoryboardVersion)
    : null;

  const { models } = await loadRegistry();
  const modelNames = Object.fromEntries(models.map((m) => [m.model_id, m.display_name]));

  let scenes: SceneView[] = [];
  let finals: FinalView[] = [];
  let blockers: string[] = [];
  let committed = 0;
  let blockedByCap = false;

  if (version) {
    const raw = await loadScenes(version.id);
    const sceneIds = raw.map((s) => s.id);
    const assetIds = raw.map((s) => s.background_asset_id).filter(Boolean) as string[];
    const [assetsRes, decisionsRes, jobsRes, qaRes, finalsRes, allJobsRes, allAssetsRes] = await Promise.all([
      assetIds.length ? db().from("assets").select("id, thumb_path, vertical_path").in("id", assetIds) : Promise.resolve({ data: [], error: null }),
      sceneIds.length ? db().from("router_decisions").select("*").in("scene_id", sceneIds).order("created_at") : Promise.resolve({ data: [], error: null }),
      sceneIds.length ? db().from("render_jobs").select("*").in("scene_id", sceneIds).order("attempt") : Promise.resolve({ data: [], error: null }),
      sceneIds.length ? db().from("qa_results").select("*").in("scene_id", sceneIds).order("created_at") : Promise.resolve({ data: [], error: null }),
      db().from("final_videos").select("*").eq("storyboard_version_id", version.id).order("created_at", { ascending: false }),
      db().from("render_jobs").select("status, credits_used, est_credits, failure_kind").eq("project_id", project.id),
      db().from("assets").select("id").eq("business_id", business.id),
    ]);
    const assets = must(assetsRes, "scene assets") as Pick<Asset, "id" | "thumb_path" | "vertical_path">[];
    const decisions = must(decisionsRes, "decisions") as RouterDecisionRow[];
    const jobs = must(jobsRes, "jobs") as RenderJob[];
    const qa = must(qaRes, "qa") as QaResult[];
    const finalRows = must(finalsRes, "finals") as FinalVideo[];
    const allJobs = must(allJobsRes, "all jobs") as Pick<RenderJob, "status" | "credits_used" | "est_credits" | "failure_kind">[];
    const allAssets = must(allAssetsRes, "all assets") as { id: string }[];

    const assetMap = new Map(assets.map((a) => [a.id, a]));
    const assetUrls = await signedUrls("assets", assets.flatMap((a) => [a.thumb_path ?? "", a.vertical_path ?? ""]), 3600);
    const mediaUrls = await signedUrls(
      "media",
      [...raw.map((s) => s.clip_path ?? ""), ...finalRows.flatMap((f) => [f.file_path ?? "", f.poster_path ?? ""])],
      3600,
    );

    scenes = raw.map((s) => {
      const a = s.background_asset_id ? assetMap.get(s.background_asset_id) : undefined;
      const d = decisions.filter((x) => x.scene_id === s.id).at(-1) ?? null;
      const q = qa.filter((x) => x.scene_id === s.id).at(-1) ?? null;
      return {
        ...s,
        photo_thumb_url: a?.thumb_path ? (assetUrls.get(a.thumb_path) ?? null) : null,
        photo_url: a?.vertical_path ? (assetUrls.get(a.vertical_path) ?? null) : null,
        clip_url: s.clip_path ? (mediaUrls.get(s.clip_path) ?? null) : null,
        model_name: s.model_id ? (modelNames[s.model_id] ?? s.model_id) : null,
        decision: d ? { reason: d.reason, confidence: d.confidence, source: d.source, flagged: d.flagged, flag_reason: d.flag_reason } : null,
        jobs: jobs
          .filter((j) => j.scene_id === s.id)
          .map((j) => ({ id: j.id, attempt: j.attempt, status: j.status, model_id: j.model_id, error: j.error, credits_used: j.credits_used, est_credits: Number(j.est_credits), failure_kind: j.failure_kind, created_at: j.created_at })),
        latest_qa: q ? { overall: q.overall, flags: q.flags, summary: q.summary, needs_review: q.needs_review, decision: q.decision } : null,
      };
    });

    finals = finalRows.map((f) => ({
      ...f,
      video_url: f.file_path && f.status === "passed" ? (mediaUrls.get(f.file_path) ?? null) : null,
      poster_url: f.poster_path ? (mediaUrls.get(f.poster_path) ?? null) : null,
    }));

    blockers = approvalBlockers(version, raw, new Set(allAssets.map((a) => a.id))).blockers;
    for (const j of allJobs) {
      if (["submitting", "submitted", "in_progress", "completed"].includes(j.status) || (j.status === "failed" && Number(j.credits_used ?? 0) > 0)) {
        committed += Number(j.credits_used ?? j.est_credits);
      }
      if (j.status === "blocked" && j.failure_kind === "cap") blockedByCap = true;
    }
  }

  return {
    project,
    versions,
    version,
    scenes,
    finals,
    blockers,
    credits: { estimated: Number(version?.est_credits ?? 0), committed: Math.round(committed * 100) / 100, cap: project.credit_cap, blockedByCap },
    modelNames,
  };
}
