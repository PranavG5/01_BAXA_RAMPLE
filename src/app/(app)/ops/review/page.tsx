import { requirePageStaff } from "@/lib/server/auth";
import { loadRegistry } from "@/lib/server/pipeline/registry";
import { signedUrls } from "@/lib/server/storage";
import { db, must } from "@/lib/server/db";
import { hardCandidates } from "@/lib/core/routing-rules";
import { labelFor } from "@/lib/core/vocabulary";
import type { QaResult } from "@/lib/types";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { ReviewActions, GradeButtons } from "@/components/OpsActions";
import { AutoRefresh } from "@/components/AutoRefresh";

export const dynamic = "force-dynamic";

type QaRow = QaResult & {
  scenes: { id: string; scene_order: number; duration_s: number; shot_type: string; motion_prompt: string; model_id: string | null; assets: { vertical_path: string | null } | null; storyboard_versions: { projects: { title: string; id: string } } } | null;
  render_jobs: { model_id: string; attempt: number; clip_path: string | null; error: string | null } | null;
  final_videos: { file_path: string | null; poster_path: string | null; projects: { title: string; id: string } } | null;
};

type DecRow = { id: string; scene_id: string; model_id: string | null; reason: string; confidence: string; flag_reason: string | null; registry_version: number };

async function byIds(table: string, ids: string[]): Promise<Map<string, Record<string, unknown>>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = must(await db().from(table).select("*").in("id", unique), `load ${table}`) as Record<string, unknown>[];
  return new Map(rows.map((r) => [r.id as string, r]));
}

export default async function ReviewPage() {
  await requirePageStaff();
  const [qaRows, flaggedRows, recentRows, registry] = await Promise.all([
    db().from("qa_results").select("*").eq("needs_review", true).is("decision", null).order("created_at").limit(30).then((r) => must(r, "review queue") as QaResult[]),
    db().from("router_decisions").select("*").eq("flagged", true).is("grade", null).order("created_at", { ascending: false }).limit(20).then((r) => must(r, "flags") as DecRow[]),
    db().from("router_decisions").select("*").eq("flagged", false).eq("source", "claude").is("grade", null).order("created_at", { ascending: false }).limit(20).then((r) => must(r, "recent") as DecRow[]),
    loadRegistry(),
  ]);

  // Join related rows in code (the local database has no embedded selects).
  const sceneIds = [...qaRows.map((q) => q.scene_id), ...flaggedRows.map((d) => d.scene_id), ...recentRows.map((d) => d.scene_id)].filter(Boolean) as string[];
  const scenes = await byIds("scenes", sceneIds);
  const [assets, versions, jobs, finals] = await Promise.all([
    byIds("assets", [...scenes.values()].map((s) => s.background_asset_id as string)),
    byIds("storyboard_versions", [...scenes.values()].map((s) => s.storyboard_version_id as string)),
    byIds("render_jobs", qaRows.map((q) => q.render_job_id ?? "")),
    byIds("final_videos", qaRows.map((q) => q.final_video_id ?? "")),
  ]);
  const projects = await byIds("projects", [...[...versions.values()].map((v) => v.project_id as string), ...[...finals.values()].map((f) => f.project_id as string)]);
  const proj = (id: unknown) => {
    const p = projects.get(id as string);
    return p ? { title: p.title as string, id: p.id as string } : { title: "Project", id: "" };
  };
  const items: QaRow[] = qaRows.map((q) => {
    const sc = q.scene_id ? scenes.get(q.scene_id) : undefined;
    const job = q.render_job_id ? jobs.get(q.render_job_id) : undefined;
    const fin = q.final_video_id ? finals.get(q.final_video_id) : undefined;
    return {
      ...q,
      scenes: sc
        ? {
            id: sc.id as string,
            scene_order: sc.scene_order as number,
            duration_s: Number(sc.duration_s),
            shot_type: sc.shot_type as string,
            motion_prompt: sc.motion_prompt as string,
            model_id: (sc.model_id as string) ?? null,
            assets: { vertical_path: (assets.get(sc.background_asset_id as string)?.vertical_path as string) ?? null },
            storyboard_versions: { projects: proj(versions.get(sc.storyboard_version_id as string)?.project_id) },
          }
        : null,
      render_jobs: job ? { model_id: job.model_id as string, attempt: job.attempt as number, clip_path: (job.clip_path as string) ?? null, error: (job.error as string) ?? null } : null,
      final_videos: fin ? { file_path: (fin.file_path as string) ?? null, poster_path: (fin.poster_path as string) ?? null, projects: proj(fin.project_id) } : null,
    };
  });
  const withScene = (d: DecRow): Dec => {
    const sc = scenes.get(d.scene_id);
    return { ...d, scenes: sc ? { scene_order: sc.scene_order as number, shot_type: sc.shot_type as string, motion_prompt: sc.motion_prompt as string, duration_s: Number(sc.duration_s) } : null };
  };
  type Dec = DecRow & { scenes: { scene_order: number; shot_type: string; motion_prompt: string; duration_s: number } | null };
  const flagged = flaggedRows.map(withScene);
  const recent = recentRows.map(withScene);
  const names = Object.fromEntries(registry.models.map((m) => [m.model_id, m.display_name]));

  const assetPaths = items.map((i) => i.scenes?.assets?.vertical_path ?? "");
  const mediaPaths = items.flatMap((i) => [i.render_jobs?.clip_path ?? "", i.final_videos?.file_path ?? "", i.final_videos?.poster_path ?? "", ...i.frame_paths]);
  const [aUrls, mUrls] = await Promise.all([signedUrls("assets", assetPaths, 3600), signedUrls("media", mediaPaths, 3600)]);

  return (
    <>
      <PageHeader title="Review queue" subtitle="Scenes that failed QA repeatedly or scored borderline, and final videos that need a look. Approve, reject, or re-render with a different model." />
      <AutoRefresh active intervalMs={15000} />
      {items.length === 0 ? (
        <EmptyState title="Nothing to review" body="New items appear here automatically." />
      ) : (
        <div className="space-y-5">
          {items.map((i) => {
            const project = i.scenes?.storyboard_versions?.projects ?? i.final_videos?.projects;
            const candidates = i.scenes
              ? hardCandidates({ order: i.scenes.scene_order, duration_s: Number(i.scenes.duration_s), treatment: "animate", shot_type: i.scenes.shot_type }, registry.models).map((m) => ({ id: m.model_id, name: m.display_name }))
              : [];
            const scores = i.automated_scores as Record<string, unknown>;
            return (
              <Card key={i.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{project?.title ?? "Project"}</p>
                  <Badge>{i.kind === "final" ? "Final video" : `Scene ${i.scenes?.scene_order}`}</Badge>
                  <Badge tone={i.overall === "fail" ? "bad" : "warn"}>{i.overall}</Badge>
                  {i.render_jobs && <Badge tone="brand">{names[i.render_jobs.model_id] ?? i.render_jobs.model_id} · attempt {i.render_jobs.attempt}</Badge>}
                </div>
                <p className="mt-2 text-sm text-muted">{i.summary}</p>
                {i.flags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {i.flags.map((f) => <Badge key={f} tone="warn">{labelFor(f)}</Badge>)}
                  </div>
                )}
                {i.kind === "scene" && (
                  <p className="mt-2 text-xs text-muted">
                    Scores: fidelity {String(scores.fidelity ?? "–")}, hands/tools {String(scores.hands_tools ?? "–")}, faces {String(scores.faces ?? "–")}, motion {String(scores.motion ?? "–")}, artifacts {String(scores.artifacts ?? "–")}, pixel similarity {typeof scores.pixel_similarity === "number" ? scores.pixel_similarity.toFixed(2) : "–"}
                  </p>
                )}
                <div className="mt-4 flex gap-3 overflow-x-auto pb-1">
                  {i.scenes?.assets?.vertical_path && (
                    <figure className="w-36 shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={aUrls.get(i.scenes.assets.vertical_path)} alt="Source" className="aspect-[9/16] w-full rounded-lg object-cover" />
                      <figcaption className="mt-1 text-xs text-muted">Source photo</figcaption>
                    </figure>
                  )}
                  {(i.render_jobs?.clip_path || i.final_videos?.file_path) && (
                    <figure className="w-36 shrink-0">
                      <video src={mUrls.get(i.render_jobs?.clip_path ?? i.final_videos!.file_path!)} controls muted loop playsInline className="aspect-[9/16] w-full rounded-lg bg-black object-cover" />
                      <figcaption className="mt-1 text-xs text-muted">Render</figcaption>
                    </figure>
                  )}
                  {i.frame_paths.map((p, k) => (
                    <figure key={p} className="w-28 shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={mUrls.get(p)} alt={`Frame ${k + 1}`} className="aspect-[9/16] w-full rounded-lg object-cover" />
                      <figcaption className="mt-1 text-xs text-muted">Frame {k + 1}</figcaption>
                    </figure>
                  ))}
                </div>
                {i.scenes && <p className="mt-2 text-xs text-muted">Motion prompt: {i.scenes.motion_prompt}</p>}
                {i.render_jobs?.error && <p className="mt-1 text-xs text-bad">Last error: {i.render_jobs.error}</p>}
                <ReviewActions qaId={i.id} kind={i.kind} candidates={candidates} hasClip={!!(i.render_jobs?.clip_path || i.final_videos?.file_path)} />
              </Card>
            );
          })}
        </div>
      )}

      <h2 className="mt-10 mb-3 text-lg font-semibold">Router flags</h2>
      <p className="mb-3 text-sm text-muted">Low confidence or no usable model. Fix the registry or pin a model, then grade the pick.</p>
      {flagged.length === 0 ? <p className="text-sm text-muted">No flagged routing decisions.</p> : <DecisionList rows={flagged} names={names} />}

      <h2 className="mt-10 mb-3 text-lg font-semibold">Grade recent router picks</h2>
      <p className="mb-3 text-sm text-muted">Agree or disagree with Claude’s model choice. These grades drive the router-accuracy metric (target 85%).</p>
      {recent.length === 0 ? <p className="text-sm text-muted">No ungraded picks.</p> : <DecisionList rows={recent} names={names} />}
    </>
  );

  function DecisionList({ rows, names }: { rows: Dec[]; names: Record<string, string> }) {
    return (
      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        {rows.map((d) => (
          <div key={d.id} className="flex flex-col gap-2 border-b border-line px-4 py-3 text-sm last:border-0 md:flex-row md:items-center">
            <div className="min-w-0 flex-1">
              <p>
                <b>{d.model_id ? (names[d.model_id] ?? d.model_id) : "No model"}</b>{" "}
                <span className="text-muted">for scene {d.scenes?.scene_order} ({labelFor(d.scenes?.shot_type ?? "")}, {Number(d.scenes?.duration_s)}s) · {d.confidence} confidence · registry v{d.registry_version}</span>
              </p>
              <p className="truncate text-xs text-muted">{d.reason} {d.flag_reason && `[${d.flag_reason}]`}</p>
              <p className="truncate text-xs text-muted">Motion: {d.scenes?.motion_prompt}</p>
            </div>
            <GradeButtons id={d.id} />
          </div>
        ))}
      </div>
    );
  }
}
