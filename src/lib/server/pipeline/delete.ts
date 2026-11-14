import "server-only";
import type { BusinessProfile, FinalVideo, RenderJob } from "../../types";
import { db, must } from "../db";
import { adapterFor } from "../providers";
import { removeObjects } from "../storage";
import { loadProject } from "./projects";

/**
 * Deletes a video project in any state: its storyboards, scenes, render jobs,
 * QA results and final videos (database cascade) and every stored file they
 * point to. Renders still running at a provider are cancelled where the
 * provider supports it, so nothing keeps working on a deleted project.
 */
export async function deleteProject(business: BusinessProfile, projectId: string) {
  const project = await loadProject(business, projectId);
  // Keep the pipeline from starting a new step on this project while it goes away.
  await db().rpc("try_lock_project", { p_project_id: project.id, p_seconds: 600 });

  const jobs = must(await db().from("render_jobs").select("*").eq("project_id", project.id), "load jobs") as RenderJob[];
  const finals = must(await db().from("final_videos").select("*").eq("project_id", project.id), "load finals") as FinalVideo[];
  const versions = must(await db().from("storyboard_versions").select("id").eq("project_id", project.id), "load versions") as { id: string }[];
  const scenes = versions.length
    ? (must(await db().from("scenes").select("voiceover_path").in("storyboard_version_id", versions.map((v) => v.id)), "load scenes") as { voiceover_path: string | null }[])
    : [];
  const qa = [
    ...(jobs.length ? (must(await db().from("qa_results").select("frame_paths").in("render_job_id", jobs.map((j) => j.id)), "load qa") as { frame_paths: string[] }[]) : []),
    ...(finals.length ? (must(await db().from("qa_results").select("frame_paths").in("final_video_id", finals.map((f) => f.id)), "load final qa") as { frame_paths: string[] }[]) : []),
  ];

  for (const j of jobs) {
    if (j.provider_request_id && ["submitting", "submitted", "in_progress"].includes(j.status)) {
      await adapterFor(j.provider).cancel(j.provider_request_id).catch(() => false);
    }
  }

  const files = [
    ...jobs.map((j) => j.clip_path),
    ...finals.flatMap((f) => [f.file_path, f.poster_path]),
    ...scenes.map((s) => s.voiceover_path),
    ...qa.flatMap((q) => q.frame_paths ?? []),
  ].filter((p): p is string => !!p);

  must(await db().from("projects").delete().eq("id", project.id), "delete project");
  // Files go after the rows, so a storage hiccup never leaves a half-deleted project behind.
  await removeObjects("media", [...new Set(files)]);
}
