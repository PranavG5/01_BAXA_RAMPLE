import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiStaff } from "@/lib/server/auth";
import { api, badRequest, readJson } from "@/lib/server/http";
import { db, must } from "@/lib/server/db";
import { MOTION_TAGS } from "@/lib/core/vocabulary";

const Tag = z.enum(MOTION_TAGS);

const ModelInput = z.object({
  model_id: z.string().regex(/^(higgsfield|pika):[\w.\-/]+$/, "model_id looks like 'pika:vendor/model/image-to-video'"),
  provider: z.enum(["higgsfield", "pika"]),
  endpoint: z.string().min(3).regex(/^[\w.\-/]+$/),
  display_name: z.string().min(1).max(120),
  status: z.enum(["usable", "usable_with_caveats", "not_usable"]),
  status_reason: z.string().max(500).default(""),
  enabled: z.boolean().default(true),
  pros: z.string().max(2000).default(""),
  cons: z.string().max(2000).default(""),
  best_for: z.array(Tag).default([]),
  avoid_for: z.array(Tag).default([]),
  start_image_support: z.boolean(),
  min_duration_s: z.number().min(0.5).max(60),
  max_duration_s: z.number().min(1).max(60),
  allowed_durations: z.array(z.number().int().positive()).nullable().default(null),
  aspect_ratios: z.array(z.string()).min(1),
  resolution: z.string().max(20),
  cost_credits_per_second: z.number().min(0).max(1000),
  latency_s: z.number().int().min(1).max(7200),
  prompt_guidelines: z.string().max(2000).default(""),
  request_config: z.object({
    image_field: z.string().min(1),
    prompt_field: z.string().min(1),
    duration_field: z.string().min(1),
    negative_prompt_field: z.string().optional(),
    static: z.record(z.string(), z.unknown()).optional(),
  }),
  evidence_links: z.array(z.string().url()).default([]),
  evaluated_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  evaluator: z.string().max(120).default(""),
});

/** FR-11/FR-15: ops edits the registry (evaluations, disable switch). Changes bump registry_version. */
export const PUT = api(async (req: Request) => {
  await requireApiStaff();
  const parsed = ModelInput.safeParse((await readJson<{ model?: unknown }>(req)).model);
  if (!parsed.success) throw badRequest(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const m = parsed.data;
  if (!m.model_id.startsWith(`${m.provider}:`)) throw badRequest("model_id must start with the provider name.");
  if (m.min_duration_s > m.max_duration_s) throw badRequest("min_duration_s is above max_duration_s.");
  const row = must(await db().from("model_registry").upsert(m, { onConflict: "model_id" }).select("*").single(), "save model");
  return NextResponse.json({ model: row });
});

export const PATCH = api(async (req: Request) => {
  await requireApiStaff();
  const { model_id, enabled } = await readJson<{ model_id?: string; enabled?: boolean }>(req);
  if (!model_id || typeof enabled !== "boolean") throw badRequest("model_id and enabled are required.");
  must(await db().from("model_registry").update({ enabled }).eq("model_id", model_id), "toggle model");
  return NextResponse.json({ ok: true });
});
