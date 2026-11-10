import { NextResponse } from "next/server";
import { env } from "@/lib/server/env";
import { advanceAll } from "@/lib/server/pipeline/render";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Safety sweep for in-flight projects. Vercel Cron sends "Authorization: Bearer $CRON_SECRET". */
export async function GET(req: Request) {
  const secret = env.cronSecret();
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const results = await advanceAll();
  return NextResponse.json({ ok: true, results });
}
