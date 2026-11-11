import { NextResponse } from "next/server";
import { requireApiStaff } from "@/lib/server/auth";
import { api, badRequest, readJson } from "@/lib/server/http";
import { db, must } from "@/lib/server/db";

/** FR-17: re-evaluation window. */
export const PUT = api(async (req: Request) => {
  await requireApiStaff();
  const { reeval_window_days } = await readJson<{ reeval_window_days?: number }>(req);
  const d = Number(reeval_window_days);
  if (!Number.isInteger(d) || d < 7 || d > 365) throw badRequest("Window must be 7 to 365 days.");
  must(await db().from("registry_meta").update({ reeval_window_days: d, updated_at: new Date().toISOString() }).eq("id", 1), "save window");
  return NextResponse.json({ ok: true });
});
