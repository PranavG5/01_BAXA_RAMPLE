import { NextResponse } from "next/server";
import { requireApiStaff } from "@/lib/server/auth";
import { api, badRequest, readJson } from "@/lib/server/http";
import { db, must } from "@/lib/server/db";
import { SHOT_TYPES } from "@/lib/core/vocabulary";

/** FR-15: pin a model to a scene type without a redeploy (null removes the pin). */
export const POST = api(async (req: Request) => {
  const { user } = await requireApiStaff();
  const { shot_type, model_id } = await readJson<{ shot_type?: string; model_id?: string | null }>(req);
  if (!shot_type || !(SHOT_TYPES as readonly string[]).includes(shot_type)) throw badRequest("Unknown shot type.");
  if (model_id) {
    must(await db().from("model_pins").upsert({ shot_type, model_id, created_by: user.email ?? user.id }, { onConflict: "shot_type" }), "pin");
  } else {
    must(await db().from("model_pins").delete().eq("shot_type", shot_type), "unpin");
  }
  return NextResponse.json({ ok: true });
});
