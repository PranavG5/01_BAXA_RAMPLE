import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/server/auth";
import { api, conflict } from "@/lib/server/http";
import { loadProject } from "@/lib/server/pipeline/projects";
import { removeObjects } from "@/lib/server/storage";
import { db, must } from "@/lib/server/supabase";

export const DELETE = api(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { business } = await requireApiUser();
  const { id } = await params;
  const project = await loadProject(business, id);
  if (["rendering", "qa"].includes(project.status)) throw conflict("Wait for rendering to finish before deleting.");
  const files = must(await db().from("final_videos").select("file_path, poster_path").eq("project_id", id), "files") as { file_path: string | null; poster_path: string | null }[];
  const clips = must(await db().from("render_jobs").select("clip_path").eq("project_id", id), "clips") as { clip_path: string | null }[];
  await removeObjects("media", [...files.flatMap((f) => [f.file_path, f.poster_path]), ...clips.map((c) => c.clip_path)]);
  must(await db().from("projects").delete().eq("id", id), "delete project");
  return NextResponse.json({ ok: true });
});
