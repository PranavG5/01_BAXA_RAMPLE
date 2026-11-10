import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/server/auth";
import { api, notFound } from "@/lib/server/http";
import { tagAsset } from "@/lib/server/pipeline/assets";
import { db } from "@/lib/server/supabase";

export const maxDuration = 120;

export const POST = api(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { business } = await requireApiUser();
  const { id } = await params;
  const { data } = await db().from("assets").select("id").eq("id", id).eq("business_id", business.id).maybeSingle();
  if (!data) throw notFound("Photo not found.");
  const asset = await tagAsset(id);
  return NextResponse.json({ asset });
});
