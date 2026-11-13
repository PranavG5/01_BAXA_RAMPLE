import { after, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/server/auth";
import { api, badRequest, readJson } from "@/lib/server/http";
import { finishIncomingAsset, tagAsset } from "@/lib/server/pipeline/assets";

export const maxDuration = 300;

/** Step 2 of a photo upload: process one photo the browser sent to storage. Claude tags it right after (FR-2). */
export const POST = api(async (req: Request) => {
  const { business } = await requireApiUser();
  const { key, name, type, consent } = await readJson<{ key?: string; name?: string; type?: string; consent?: boolean }>(req);
  if (!key) throw badRequest("Missing upload key.");
  const asset = await finishIncomingAsset(business, key, String(name ?? "photo"), String(type ?? ""), consent === true);
  after(() => tagAsset(asset.id).then(() => undefined, (e) => console.error("[tag] failed", asset.id, e)));
  return NextResponse.json({ id: asset.id });
});
