import "server-only";
import { hardCandidates } from "../../core/routing-rules";
import type { FinalVideo, Project, QaResult, RenderJob, Scene } from "../../types";
import { audit } from "../audit";
import { badRequest, conflict, notFound } from "../http";
import { db, must } from "../db";
import { loadScenes, loadVersion } from "./projects";
import { loadRegistry } from "./registry";
import { assemble, createJob, syncProjectStatus } from "./render";

export type ReviewDecision = "approved" | "rejected" | "rerender";

async function loadQa(id: string): Promise<QaResult> {
  const qa = must(await db().from("qa_results").select("*").eq("id", id).maybeSingle(), "load qa") as QaResult | null;
  if (!qa) throw notFound("Review item not found.");
  if (qa.decision) throw conflict("This item was already reviewed.");
  return qa;
}

async function failVersion(projectId: string, versionId: string, reason: string) {
  const v = await loadVersion(versionId);
  if (["approved", "rendering", "qa"].includes(v.state)) {
    must(await db().from("storyboard_versions").update({ state: "failed", failure_reason: reason }).eq("id", versionId), "fail version");
  }
  await syncProjectStatus(projectId);
}

/** FR-28 / PRD 3.4: approve, reject, or send a scene back for re-render with a different model. */
export async function decide(qaId: string, decision: ReviewDecision, reviewer: string, note: string, modelId?: string) {
  const qa = await loadQa(qaId);
  const stamp = { decision, reviewer, decision_note: note.slice(0, 1000), decided_at: new Date().toISOString(), needs_review: false };

  if (qa.kind === "final") {
    const final = must(await db().from("final_videos").select("*").eq("id", qa.final_video_id!).single(), "load final") as FinalVideo;
    const project = must(await db().from("projects").select("*").eq("id", final.project_id).single(), "load project") as Project;
    const version = await loadVersion(final.storyboard_version_id);
    if (decision === "approved") {
      if (!final.file_path) throw badRequest("This video has no file to approve.");
      must(await db().from("final_videos").update({ status: "passed", updated_at: new Date().toISOString() }).eq("id", final.id), "approve final");
      if (["approved", "rendering", "qa"].includes(version.state)) {
        must(await db().from("storyboard_versions").update({ state: "complete" }).eq("id", version.id), "complete version");
      }
    } else if (decision === "rejected") {
      must(await db().from("final_videos").update({ status: "rejected", updated_at: new Date().toISOString() }).eq("id", final.id), "reject final");
      await failVersion(project.id, version.id, `Final video rejected in review: ${note}`);
    } else {
      must(await db().from("final_videos").update({ status: "rejected", updated_at: new Date().toISOString() }).eq("id", final.id), "supersede final");
      must(await db().from("qa_results").update(stamp).eq("id", qa.id), "stamp review");
      await assemble(project, version, await loadScenes(version.id), final.assembly_attempt + 1);
    }
    must(await db().from("qa_results").update(stamp).eq("id", qa.id), "stamp review");
    await syncProjectStatus(project.id);
    await audit(project.id, reviewer, `review.final.${decision}`, { qa: qa.id, note });
    return;
  }

  const scene = must(await db().from("scenes").select("*").eq("id", qa.scene_id!).single(), "load scene") as Scene;
  const job = qa.render_job_id
    ? (must(await db().from("render_jobs").select("*").eq("id", qa.render_job_id).single(), "load job") as RenderJob)
    : null;
  const version = await loadVersion(scene.storyboard_version_id);
  const projectId = job?.project_id ?? version.project_id;

  if (decision === "approved") {
    if (!job?.clip_path) throw badRequest("There is no clip to approve. Re-render instead.");
    must(await db().from("scenes").update({ render_status: "passed", clip_path: job.clip_path }).eq("id", scene.id), "approve scene");
  } else if (decision === "rejected") {
    must(await db().from("scenes").update({ render_status: "rejected" }).eq("id", scene.id), "reject scene");
    await failVersion(projectId, version.id, `Scene ${scene.scene_order} was rejected in review: ${note}`);
  } else {
    if (!modelId) throw badRequest("Pick a model for the re-render.");
    const { models } = await loadRegistry();
    const candidates = hardCandidates({ order: scene.scene_order, duration_s: Number(scene.duration_s), treatment: "animate", shot_type: scene.shot_type }, models);
    const model = candidates.find((m) => m.model_id === modelId);
    if (!model) throw badRequest("That model cannot render this scene (check duration, start image and status).");
    const attempts = must(await db().from("render_jobs").select("attempt").eq("scene_id", scene.id), "attempts") as { attempt: number }[];
    const nextAttemptNo = Math.max(0, ...attempts.map((a) => a.attempt)) + 1;
    await createJob({
      project: { id: projectId },
      version,
      scene: { ...scene, duration_s: Number(scene.duration_s) },
      model,
      attempt: nextAttemptNo,
      initiatedBy: `reviewer:${reviewer}`,
    });
    if (version.state === "qa") must(await db().from("storyboard_versions").update({ state: "rendering" }).eq("id", version.id), "back to rendering");
  }
  must(await db().from("qa_results").update(stamp).eq("id", qa.id), "stamp review");
  await syncProjectStatus(projectId);
  await audit(projectId, reviewer, `review.scene.${decision}`, { qa: qa.id, scene: scene.scene_order, note, model: modelId ?? null });
}

/** Router accuracy grading (PRD 10). */
export async function gradeDecision(decisionId: string, grade: "agree" | "disagree", grader: string, note: string) {
  must(
    await db().from("router_decisions").update({ grade, graded_by: grader, grade_note: note.slice(0, 500) }).eq("id", decisionId),
    "grade decision",
  );
}
