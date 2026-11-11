import "server-only";
import { db, must } from "./db";

/** Final video owned by this business, with its project's title. */
export async function ownedFinalVideo(businessId: string, id: string) {
  const f = must(await db().from("final_videos").select("*").eq("id", id).maybeSingle(), "load video");
  if (!f) return null;
  const p = must(await db().from("projects").select("id, title, business_id").eq("id", f.project_id).maybeSingle(), "load project");
  if (!p || p.business_id !== businessId) return null;
  return { ...f, project_title: p.title as string } as {
    id: string; project_id: string; file_path: string | null; poster_path: string | null; export_count: number; status: string; project_title: string;
  };
}

/** Project id for a review item (scene or final video). */
export async function projectIdForQa(qaId: string): Promise<string | null> {
  const qa = must(await db().from("qa_results").select("scene_id, final_video_id").eq("id", qaId).maybeSingle(), "load qa");
  if (!qa) return null;
  if (qa.final_video_id) {
    const f = must(await db().from("final_videos").select("project_id").eq("id", qa.final_video_id).maybeSingle(), "load final");
    return f?.project_id ?? null;
  }
  if (qa.scene_id) {
    const s = must(await db().from("scenes").select("storyboard_version_id").eq("id", qa.scene_id).maybeSingle(), "load scene");
    if (!s) return null;
    const v = must(await db().from("storyboard_versions").select("project_id").eq("id", s.storyboard_version_id).maybeSingle(), "load version");
    return v?.project_id ?? null;
  }
  return null;
}
