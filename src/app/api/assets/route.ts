import { after, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/server/auth";
import { api, badRequest } from "@/lib/server/http";
import { tagAsset, uploadAsset } from "@/lib/server/pipeline/assets";
import type { Asset } from "@/lib/types";

export const maxDuration = 300;

/** FR-1: upload photos (multipart: files[], consent). Claude tags each right after (FR-2). */
export const POST = api(async (req: Request) => {
  const { business } = await requireApiUser();
  const form = await req.formData();
  const consent = form.get("consent") === "true";
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) throw badRequest("Choose at least one photo.");
  if (files.length > 20) throw badRequest("Upload up to 20 photos at a time.");
  const created: Asset[] = [];
  const failed: { name: string; error: string }[] = [];
  for (const file of files) {
    try {
      created.push(await uploadAsset(business, file, consent));
    } catch (err) {
      failed.push({ name: file.name, error: err instanceof Error ? err.message : "Upload failed" });
    }
  }
  after(async () => {
    for (const a of created) await tagAsset(a.id).catch((e) => console.error("[tag] failed", a.id, e));
  });
  return NextResponse.json({ created: created.map((a) => a.id), failed });
});
