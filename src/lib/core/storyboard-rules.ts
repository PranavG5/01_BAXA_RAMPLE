// Deterministic storyboard rules (PRD 6.2, 6.3, FR-6, FR-7, FR-10, FR-14, FR-22).
import { STORYBOARD_LIMITS as L, STILL_EFFECTS, type StillEffect } from "./vocabulary.ts";
import type { SceneDraft } from "./schemas.ts";

export interface LibraryAssetLite {
  id: string;
  usable: boolean;
  area: string | null;
  faces_visible: boolean;
  description?: string | null;
}

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

/** Text the video model must never be asked to render (PRD design principle 2). */
export function mentionsForbiddenRendering(prompt: string): string | null {
  const noun = "(?:any\\s+|new\\s+)?(?:on-screen\\s+)?(?:text|logos?|words|lettering|letters|prices?|numbers?|captions?|signage changes|watermarks?)";
  const negatedList = new RegExp(
    `\\b(?:no|without|avoid|never|don't add|do not add|not)\\s+${noun}(?:\\s*(?:,|or|and|nor)\\s*${noun})*\\b`,
    "gi",
  );
  const cleaned = prompt.replace(negatedList, " ");
  const m = cleaned.match(/\$\s?\d|\b\d+\s?%|\blogos?\b|\btext\b|\blettering\b|\bprices?\b|\bwords?\b|\bcaptions?\b|\bwatermarks?\b/i);
  return m ? m[0] : null;
}

/** Sort, renumber 1..n and round durations to the nearest half second. */
export function normalizeScenes<T extends SceneDraft>(scenes: T[]): T[] {
  return [...scenes]
    .sort((a, b) => a.order - b.order)
    .map((s, i) => {
      const effect =
        s.treatment === "animate"
          ? null
          : s.still_motion_effect && (STILL_EFFECTS as readonly string[]).includes(s.still_motion_effect)
            ? s.still_motion_effect
            : (defaultEffect(i) as StillEffect);
      return {
        ...s,
        order: i + 1,
        duration_s: Math.max(0.5, Math.round(s.duration_s * 2) / 2),
        motion_prompt: s.treatment === "animate" ? s.motion_prompt.trim() : "",
        still_motion_effect: effect,
        voiceover: s.voiceover.trim(),
        on_screen_text: s.on_screen_text.trim(),
      };
    });
}

function defaultEffect(i: number): StillEffect {
  return (["zoomInSlow", "slideLeftSlow", "zoomOutSlow", "slideRightSlow"] as const)[i % 4];
}

export function totalRuntime(scenes: { duration_s: number }[]): number {
  return Math.round(scenes.reduce((s, x) => s + Number(x.duration_s), 0) * 10) / 10;
}

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function validateStoryboard(
  scenes: SceneDraft[],
  library: Map<string, LibraryAssetLite>,
  opts: { offer?: string } = {},
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const n = scenes.length;

  if (n < L.minScenes || n > L.maxScenes) {
    errors.push(`A storyboard needs ${L.minScenes} to ${L.maxScenes} scenes (got ${n}).`);
  }
  if (n === 0) return { errors, warnings };

  const sorted = [...scenes].sort((a, b) => a.order - b.order);
  const hook = sorted[0];
  if (hook.role !== "hook") errors.push("Scene 1 must be the hook.");
  if (hook.duration_s > L.hookMaxSeconds) errors.push(`The hook must last ${L.hookMaxSeconds} seconds or less.`);
  if (hook.treatment === "end_card") errors.push("The hook cannot be an end card or logo intro.");
  if (sorted.filter((s) => s.role === "hook").length > 1) errors.push("Only scene 1 can be the hook.");

  const runtime = totalRuntime(sorted);
  if (runtime < L.hardMinSeconds || runtime > L.hardMaxSeconds) {
    errors.push(`Total runtime ${runtime}s is outside ${L.hardMinSeconds}-${L.hardMaxSeconds}s.`);
  } else if (runtime < L.targetMinSeconds || runtime > L.targetMaxSeconds) {
    warnings.push(`Total runtime ${runtime}s is outside the ${L.targetMinSeconds}-${L.targetMaxSeconds}s target.`);
  }

  const endCards = sorted.filter((s) => s.treatment === "end_card");
  if (endCards.length > 1) errors.push("Use at most one end card.");
  if (endCards.length === 1 && sorted[n - 1].treatment !== "end_card") errors.push("The end card must be the last scene.");

  sorted.forEach((s, i) => {
    const label = `Scene ${i + 1}`;
    if (s.duration_s < L.sceneMinSeconds || s.duration_s > L.sceneMaxSeconds) {
      errors.push(`${label}: duration must be ${L.sceneMinSeconds}-${L.sceneMaxSeconds}s.`);
    }
    if (!s.background_asset_id) {
      errors.push(`${label}: every scene needs a background photo.`);
    } else {
      const asset = library.get(s.background_asset_id);
      if (!asset) errors.push(`${label}: background photo ${s.background_asset_id} is not in the library.`);
      else {
        if (!asset.usable) warnings.push(`${label}: the chosen photo was flagged as low quality.`);
        if (s.treatment === "animate" && asset.faces_visible && (s.shot_type === "medium" || s.shot_type === "close_up")) {
          warnings.push(`${label}: animating a visible face is a last resort; prefer over-the-shoulder or from-behind.`);
        }
      }
    }
    if (s.treatment === "animate") {
      if (!s.motion_prompt.trim()) errors.push(`${label}: animated scenes need a motion prompt.`);
      const bad = mentionsForbiddenRendering(s.motion_prompt);
      if (bad) errors.push(`${label}: the motion prompt asks the video model to render "${bad}". Text, prices and logos are added in assembly only.`);
    }
    if (s.on_screen_text.length > L.overlayMaxChars) errors.push(`${label}: overlay text is too long (max ${L.overlayMaxChars} characters).`);
    else if (s.on_screen_text.length > 48) warnings.push(`${label}: overlay text over 48 characters is hard to read on a phone.`);
    const maxWords = Math.ceil(s.duration_s * L.wordsPerSecond) + 1;
    if (wordCount(s.voiceover) > maxWords) warnings.push(`${label}: voiceover may run past ${s.duration_s}s (${wordCount(s.voiceover)} words).`);
  });

  if (opts.offer) {
    const price = opts.offer.match(/\$\s?\d+(?:\.\d{2})?/);
    const hookText = `${hook.on_screen_text} ${hook.voiceover}`;
    if (price && !hookText.replace(/\s/g, "").includes(price[0].replace(/\s/g, ""))) {
      warnings.push(`The hook does not mention the offer (${price[0]}).`);
    }
  }

  return { errors, warnings };
}

/** FNV-1a 32-bit hash, stable across server and browser. */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Fields that change what the video model produces. Text/voice edits do not. */
export function renderKey(s: {
  treatment: string;
  background_asset_id: string | null;
  duration_s: number;
  shot_type: string;
  motion_prompt: string;
  subject_description: string | null;
}): string {
  return fnv1a(
    JSON.stringify([
      s.treatment,
      s.background_asset_id,
      Number(s.duration_s),
      s.shot_type,
      s.motion_prompt.trim(),
      (s.subject_description ?? "").trim(),
    ]),
  );
}

export interface ModelCost {
  min_duration_s: number;
  max_duration_s: number;
  allowed_durations: number[] | null;
  cost_credits_per_second: number;
}

/** Duration the provider will actually generate (and bill) for a scene. */
export function billedDuration(model: ModelCost, sceneSeconds: number): number | null {
  if (sceneSeconds > model.max_duration_s) return null;
  if (model.allowed_durations && model.allowed_durations.length) {
    const fits = [...model.allowed_durations].sort((a, b) => a - b).find((d) => d >= sceneSeconds);
    return fits ?? null;
  }
  return Math.max(Number(model.min_duration_s), Math.ceil(sceneSeconds));
}

export function estimateSceneCredits(model: ModelCost | undefined, sceneSeconds: number, treatment: string): number {
  if (treatment !== "animate" || !model) return 0;
  const d = billedDuration(model, sceneSeconds);
  if (d === null) return 0;
  return Math.round(d * Number(model.cost_credits_per_second) * 100) / 100;
}
