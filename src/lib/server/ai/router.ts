import "server-only";
import { RouterOutputSchema, type Brief, type RouterDecisionOut } from "../../core/schemas";
import { hardCandidates, sanitizeFallbacks, validatePick, type RegistryModel } from "../../core/routing-rules";
import { billedDuration } from "../../core/storyboard-rules";
import type { Asset } from "../../types";
import { asData, structured } from "./claude";

/**
 * Claude routes each animated scene to a registry model (PRD 5.1 step 3).
 * Claude only sees read-only registry data here; it has no tool that can
 * submit a render or spend credits (FR-20).
 */
const SYSTEM = `You route each animated scene of a short salon or barbershop ad to the image-to-video model that fits it best.

Visual quality is the goal. Cost and speed do not matter: never choose a model because it is cheaper or faster.

Decision order:
1. Hard constraints are already applied: each scene lists only candidate models that support its duration, 9:16 output and a start image. Pick only from that scene's candidates.
2. Fit: match the scene (shot type, subject, the photo's motion tags, whether a face is visible) against each model's best_for and avoid_for tags, then its pros and cons text. A model whose avoid_for matches the scene is a poor fit.
3. Quality: among models that fit, pick the one most likely to give the most realistic, artifact-free result that stays faithful to the photo: hands and tools that keep their shape, natural hair and skin, steady architecture, smooth motion. Prefer the newest flagship generation and its top tier (Pro, Prime, 4.0 over 3.0) over lighter tiers (Turbo, Fast, Lite, Mini, Standard), and higher output resolution (1080p over 768p or 720p).

For each scene return: model_id, a one-sentence reason, a ranked fallback list (1 to 2 other candidates, also ranked by quality), a confidence (high, medium, low), and model_prompt: the scene's motion prompt rewritten for the chosen model using its prompt_guidelines. model_prompt must keep the background exactly as in the photo and must never ask for text, prices, logos or new people.

If no candidate fits, set model_id to null and confidence to low. Do not guess: low confidence is sent to Rample ops for review.`;

export interface AnimatedSceneForRouting {
  order: number;
  duration_s: number;
  shot_type: string;
  motion_prompt: string;
  subject_description: string | null;
  asset: Pick<Asset, "id" | "area" | "angle" | "description" | "tags" | "faces_visible"> | null;
}

export interface ValidatedDecision {
  order: number;
  model_id: string | null;
  fallback: string[];
  reason: string;
  confidence: "high" | "medium" | "low" | "none";
  model_prompt: string;
  flagged: boolean;
  flag_reason: string | null;
  attempts: number;
}

function modelCard(m: RegistryModel, sceneSeconds: number): string {
  return JSON.stringify({
    model_id: m.model_id,
    provider: m.provider,
    name: m.display_name,
    status: m.status,
    best_for: m.best_for,
    avoid_for: m.avoid_for,
    pros: m.pros,
    cons: m.cons,
    output_resolution: m.resolution,
    billed_seconds_for_scene: billedDuration(m, sceneSeconds),
    prompt_guidelines: m.prompt_guidelines,
  });
}

export async function routeScenes(input: {
  brief: Brief;
  scenes: AnimatedSceneForRouting[];
  models: RegistryModel[];
}): Promise<ValidatedDecision[]> {
  if (input.scenes.length === 0) return [];
  const candidates = new Map(input.scenes.map((s) => [s.order, hardCandidates({ ...s, treatment: "animate" }, input.models)]));
  const out = new Map<number, ValidatedDecision>();

  // Scenes with no candidate at all are flagged without asking Claude.
  for (const s of input.scenes) {
    if ((candidates.get(s.order) ?? []).length === 0) {
      out.set(s.order, {
        order: s.order,
        model_id: null,
        fallback: [],
        reason: "No usable model in the registry supports this scene's duration, 9:16 output and start image.",
        confidence: "none",
        model_prompt: s.motion_prompt,
        flagged: true,
        flag_reason: "no_usable_model",
        attempts: 0,
      });
    }
  }

  let pending = input.scenes.filter((s) => !out.has(s.order));
  let feedback = "";
  for (let attempt = 1; attempt <= 3 && pending.length > 0; attempt++) {
    const sceneText = pending
      .map((s) => {
        const c = candidates.get(s.order) ?? [];
        return `<scene order="${s.order}">
duration_s: ${s.duration_s}
shot_type: ${s.shot_type}
motion_prompt: ${asData(s.motion_prompt)}
subject: ${asData(s.subject_description ?? "none")}
photo: ${s.asset ? asData(`area=${s.asset.area} angle=${s.asset.angle} faces_visible=${s.asset.faces_visible} motion_tags=[${s.asset.tags.join(",")}] description="${s.asset.description ?? ""}"`) : "missing"}
candidates:
${c.map((m) => modelCard(m, s.duration_s)).join("\n")}
</scene>`;
      })
      .join("\n\n");

    const res = await structured({
      schema: RouterOutputSchema,
      system: SYSTEM,
      effort: "medium",
      maxTokens: 8000,
      content: `<brief_summary>${asData(`${input.brief.goal}: ${input.brief.title}. Tone: ${input.brief.tone}.`)}</brief_summary>

${sceneText}

Return one decision per scene.${feedback}`,
    });

    const problems: string[] = [];
    const byOrder = new Map<number, RouterDecisionOut>(res.decisions.map((d) => [Math.round(d.scene_order), d]));
    for (const s of pending) {
      const d = byOrder.get(s.order);
      const c = candidates.get(s.order) ?? [];
      if (!d) {
        problems.push(`scene ${s.order}: missing decision`);
        continue;
      }
      const check = validatePick({ model_id: d.model_id, fallback: d.fallback }, c);
      if (!check.ok) {
        problems.push(`scene ${s.order}: ${check.errors.join("; ")}`);
        continue;
      }
      const lowConfidence = d.model_id === null || d.confidence === "low";
      out.set(s.order, {
        order: s.order,
        model_id: d.model_id,
        fallback: d.model_id ? sanitizeFallbacks(d.model_id, d.fallback, c) : [],
        reason: d.reason,
        confidence: d.model_id ? d.confidence : "none",
        model_prompt: d.model_prompt || s.motion_prompt,
        flagged: lowConfidence,
        flag_reason: lowConfidence ? (d.model_id ? "low_confidence" : "no_fit") : null,
        attempts: attempt,
      });
    }
    pending = pending.filter((s) => !out.has(s.order));
    feedback = problems.length
      ? `\n\nThe server rejected some picks. Choose only from each scene's candidates:\n- ${problems.join("\n- ")}`
      : "";
  }

  // Still invalid after three tries: flag to ops rather than guess.
  for (const s of pending) {
    out.set(s.order, {
      order: s.order,
      model_id: null,
      fallback: [],
      reason: "Router could not produce a valid pick after 3 attempts.",
      confidence: "none",
      model_prompt: s.motion_prompt,
      flagged: true,
      flag_reason: "invalid_after_retries",
      attempts: 3,
    });
  }
  return input.scenes.map((s) => out.get(s.order)!);
}
