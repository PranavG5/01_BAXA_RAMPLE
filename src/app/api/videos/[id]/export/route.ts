import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/server/auth";
import { audit } from "@/lib/server/audit";
import { api, notFound } from "@/lib/server/http";
import { signedUrl } from "@/lib/server/storage";
import { db, must } from "@/lib/server/db";
import { ownedFinalVideo } from "@/lib/server/ownership";

/** FR-29: export a QA-passed video. Returns a short-lived download link. */
export const POST = api(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { business, user } = await requireApiUser();
  const { id } = await params;
  const row = await ownedFinalVideo(business.id, id);
  if (!row?.file_path || row.status !== "passed") throw notFound("Video not found or not approved yet.");
  const name = `${(row.project_title || "rample-video").replace(/[^\w-]+/g, "-").slice(0, 60)}.mp4`;
  const url = await signedUrl("media", row.file_path, 600, name);
  must(await db().from("final_videos").update({ export_count: row.export_count + 1, last_exported_at: new Date().toISOString() }).eq("id", id), "count export");
  await audit(row.project_id, user.id, "video.exported", { video: id });
  return NextResponse.json({ url });
});
