import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/server/auth";
import { api, badRequest } from "@/lib/server/http";
import { normalizeLogo } from "@/lib/server/media/image";
import { putObject } from "@/lib/server/storage";
import { db, must } from "@/lib/server/db";

export const POST = api(async (req: Request) => {
  const { business } = await requireApiUser();
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) throw badRequest("Choose a logo image.");
  if (file.size > 10 * 1024 * 1024) throw badRequest("Logo must be 10 MB or smaller.");
  let png: Buffer;
  try {
    png = await normalizeLogo(Buffer.from(await file.arrayBuffer()));
  } catch {
    throw badRequest("Logo must be a PNG, JPEG, WebP or SVG image.");
  }
  const path = `${business.id}/logo-${Date.now()}.png`;
  await putObject("assets", path, png, "image/png");
  must(await db().from("business_profiles").update({ logo_path: path }).eq("id", business.id), "save logo");
  return NextResponse.json({ ok: true });
});
