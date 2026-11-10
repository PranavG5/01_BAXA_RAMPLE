import { after, NextResponse } from "next/server";
import { requireApiStaff } from "@/lib/server/auth";
import { api, badRequest, readJson } from "@/lib/server/http";
import { advanceProject } from "@/lib/server/pipeline/render";
import { decide, type ReviewDecision } from "@/lib/server/pipeline/review";
import { db } from "@/lib/server/supabase";

export const maxDuration = 300;

/** PRD 3.4: approve, reject, or re-render a scene (or final video) with a different model. */
export const POST = api(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { user } = await requireApiStaff();
  const { id } = await params;
  const body = await readJson<{ decision?: string; note?: string; modelId?: string }>(req);
  if (!["approved", "rejected", "rerender"].includes(String(body.decision))) throw badRequest("Unknown decision.");
  await decide(id, body.decision as ReviewDecision, user.email ?? user.id, String(body.note ?? ""), body.modelId);
  const { data } = await db().from("qa_results").select("scene_id, final_video_id, scenes(storyboard_versions(project_id)), final_videos(project_id)").eq("id", id).maybeSingle();
  const row = data as { scenes?: { storyboard_versions?: { project_id?: string } }; final_videos?: { project_id?: string } } | null;
  const projectId = row?.scenes?.storyboard_versions?.project_id ?? row?.final_videos?.project_id;
  if (projectId) after(() => advanceProject(projectId).then(() => undefined).catch((e) => console.error("[advance]", e)));
  return NextResponse.json({ ok: true });
});
