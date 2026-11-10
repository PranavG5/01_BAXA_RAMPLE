import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/server/auth";
import { api, notFound } from "@/lib/server/http";
import { removeObjects } from "@/lib/server/storage";
import { db, must } from "@/lib/server/supabase";

/** NFR privacy: owners can delete their videos. */
export const DELETE = api(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { business } = await requireApiUser();
  const { id } = await params;
  const row = must(
    await db().from("final_videos").select("id, file_path, poster_path, projects!inner(business_id)").eq("id", id).eq("projects.business_id", business.id).maybeSingle(),
    "load video",
  ) as { id: string; file_path: string | null; poster_path: string | null } | null;
  if (!row) throw notFound("Video not found.");
  await removeObjects("media", [row.file_path, row.poster_path]);
  must(await db().from("final_videos").delete().eq("id", id), "delete video");
  return NextResponse.json({ ok: true });
});
