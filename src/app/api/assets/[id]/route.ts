import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/server/auth";
import { api, readJson } from "@/lib/server/http";
import { deleteAsset, updateAssetTags } from "@/lib/server/pipeline/assets";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = api(async (req: Request, { params }: Ctx) => {
  const { business } = await requireApiUser();
  const { id } = await params;
  const body = await readJson<Record<string, unknown>>(req);
  const asset = await updateAssetTags(business, id, body);
  return NextResponse.json({ asset });
});

export const DELETE = api(async (_req: Request, { params }: Ctx) => {
  const { business } = await requireApiUser();
  const { id } = await params;
  await deleteAsset(business, id);
  return NextResponse.json({ ok: true });
});
