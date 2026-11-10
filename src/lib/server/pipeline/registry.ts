import "server-only";
import type { RegistryModel } from "../../core/routing-rules";
import { db, must } from "../supabase";

function toModel(row: Record<string, unknown>): RegistryModel {
  return {
    ...(row as unknown as RegistryModel),
    min_duration_s: Number(row.min_duration_s),
    max_duration_s: Number(row.max_duration_s),
    cost_credits_per_second: Number(row.cost_credits_per_second),
    allowed_durations: (row.allowed_durations as number[] | null) ?? null,
  };
}

export async function loadRegistry(): Promise<{ models: RegistryModel[]; version: number; windowDays: number }> {
  const [models, meta] = await Promise.all([
    db().from("model_registry").select("*").order("provider").order("display_name"),
    db().from("registry_meta").select("*").eq("id", 1).single(),
  ]);
  const m = must(models, "load registry") as Record<string, unknown>[];
  const mt = must(meta, "load registry meta") as { registry_version: number; reeval_window_days: number };
  return { models: m.map(toModel), version: mt.registry_version, windowDays: mt.reeval_window_days };
}

export async function loadPins(): Promise<Map<string, string>> {
  const rows = must(await db().from("model_pins").select("shot_type, model_id"), "load pins") as { shot_type: string; model_id: string }[];
  return new Map(rows.map((r) => [r.shot_type, r.model_id]));
}
