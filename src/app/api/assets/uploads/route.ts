import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/server/auth";
import { api, badRequest, readJson } from "@/lib/server/http";
import { incomingKey, MAX_PHOTO_BYTES } from "@/lib/server/pipeline/assets";
import { createUploadTarget } from "@/lib/server/storage";

/**
 * Step 1 of a photo upload: one-time links for the browser to send each photo
 * straight to Supabase Storage (Vercel caps request bodies at 4.5 MB).
 * `direct: false` means local storage: post the files to /api/assets instead.
 */
export const POST = api(async (req: Request) => {
  const { business } = await requireApiUser();
  const { files } = await readJson<{ files?: { name?: string; size?: number }[] }>(req);
  if (!Array.isArray(files) || !files.length) throw badRequest("Choose at least one photo.");
  if (files.length > 20) throw badRequest("Upload up to 20 photos at a time.");
  const uploads: { key: string; url: string }[] = [];
  for (const f of files) {
    if (typeof f?.size === "number" && f.size > MAX_PHOTO_BYTES) throw badRequest(`${f.name ?? "A photo"} is over 20 MB.`);
    const key = incomingKey(business.id, String(f?.name ?? "photo"));
    const target = await createUploadTarget("assets", key);
    if (!target) return NextResponse.json({ direct: false });
    uploads.push({ key, url: target.url });
  }
  return NextResponse.json({ direct: true, uploads });
});
