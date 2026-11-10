// Router hard constraints and server-side validation (PRD 5.1 step 4, 5.3, FR-13, FR-17).
import { billedDuration } from "./storyboard-rules.ts";

export interface RegistryModel {
  model_id: string;
  provider: "higgsfield" | "pika";
  endpoint: string;
  display_name: string;
  status: "usable" | "usable_with_caveats" | "not_usable";
  status_reason: string;
  enabled: boolean;
  pros: string;
  cons: string;
  best_for: string[];
  avoid_for: string[];
  start_image_support: boolean;
  min_duration_s: number;
  max_duration_s: number;
  allowed_durations: number[] | null;
  aspect_ratios: string[];
  resolution: string;
  cost_credits_per_second: number;
  latency_s: number;
  prompt_guidelines: string;
  request_config: RequestConfig;
  evidence_links: string[];
  evaluated_on: string | null;
  evaluator: string;
  registry_version: number;
}

export interface RequestConfig {
  image_field: string;
  prompt_field: string;
  duration_field: string;
  negative_prompt_field?: string;
  static?: Record<string, unknown>;
}

export interface RoutableScene {
  order: number;
  duration_s: number;
  treatment: string;
  shot_type: string;
}

/** Models the router may consider at all: enabled, usable, animate from a photo. */
export function routableModels(models: RegistryModel[]): RegistryModel[] {
  return models.filter((m) => m.enabled && m.status !== "not_usable" && m.start_image_support);
}

/** Hard constraints first (PRD 5.3): duration, aspect ratio, start-image support. */
export function hardCandidates(scene: RoutableScene, models: RegistryModel[]): RegistryModel[] {
  return routableModels(models).filter((m) => {
    const aspectOk = m.aspect_ratios.includes("9:16") || m.aspect_ratios.includes("follows_input");
    return aspectOk && billedDuration(m, Number(scene.duration_s)) !== null;
  });
}

export interface PickValidation {
  ok: boolean;
  errors: string[];
}

/** Server check on a single router pick (FR-13). */
export function validatePick(
  pick: { model_id: string | null; fallback: string[] },
  candidates: RegistryModel[],
): PickValidation {
  const errors: string[] = [];
  const ids = new Set(candidates.map((c) => c.model_id));
  if (pick.model_id === null) {
    if (candidates.length > 0) errors.push("returned no model although candidates exist");
    return { ok: errors.length === 0, errors };
  }
  if (!ids.has(pick.model_id)) errors.push(`model ${pick.model_id} is not a valid candidate for this scene`);
  for (const f of pick.fallback) {
    if (!ids.has(f)) errors.push(`fallback ${f} is not a valid candidate for this scene`);
    if (f === pick.model_id) errors.push("fallback repeats the primary model");
  }
  return { ok: errors.length === 0, errors };
}

/** Clean fallbacks: valid, unique, not the primary; add the cheapest other candidate if empty. */
export function sanitizeFallbacks(primary: string, fallback: string[], candidates: RegistryModel[]): string[] {
  const ids = new Set(candidates.map((c) => c.model_id));
  const out: string[] = [];
  for (const f of fallback) if (ids.has(f) && f !== primary && !out.includes(f)) out.push(f);
  if (out.length === 0) {
    const cheapest = [...candidates]
      .filter((c) => c.model_id !== primary)
      .sort((a, b) => a.cost_credits_per_second - b.cost_credits_per_second)[0];
    if (cheapest) out.push(cheapest.model_id);
  }
  return out.slice(0, 2);
}

/** FR-17: entries never evaluated, or evaluated before the window, are stale. */
export function isStale(model: { evaluated_on: string | null }, windowDays: number, now = new Date()): boolean {
  if (!model.evaluated_on) return true;
  const evaluated = new Date(model.evaluated_on + "T00:00:00Z").getTime();
  return now.getTime() - evaluated > windowDays * 86_400_000;
}
