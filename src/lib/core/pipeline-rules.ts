// State machine (FR-18), retry policy (FR-27) and QA verdicts (FR-25, FR-26, FR-28).
import { MAX_RENDER_ATTEMPTS } from "./vocabulary.ts";
import type { ClipQa } from "./schemas.ts";

// ---------------- Storyboard version state machine ----------------
export type VersionState = "draft" | "revised" | "approved" | "rendering" | "qa" | "complete" | "failed";

const TRANSITIONS: Record<VersionState, VersionState[]> = {
  draft: ["approved"],
  revised: ["approved"],
  approved: ["rendering", "qa", "failed"],
  rendering: ["qa", "failed"],
  qa: ["rendering", "complete", "failed"],
  complete: [],
  failed: [],
};

export function canTransition(from: VersionState, to: VersionState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: VersionState, to: VersionState): void {
  if (!canTransition(from, to)) throw new Error(`Invalid storyboard state change: ${from} -> ${to}`);
}

// ---------------- Retry policy ----------------
export interface RetryInput {
  attempt: number; // attempt that just failed (1-based)
  failureKind: "provider" | "qa";
  failedModel: string;
  primary: string;
  fallbacks: string[];
  maxAttempts?: number;
}

/**
 * Decide the next attempt for a failed scene, or null to send it to human review.
 * - QA failures retry on the primary model, with the fallback on the last attempt.
 * - A provider failure retries once on the fallback model (PRD 5.3).
 * - Anything that fails on the fallback goes to human review.
 */
export function nextAttempt(input: RetryInput): { attempt: number; model: string } | null {
  const max = input.maxAttempts ?? MAX_RENDER_ATTEMPTS;
  const fallback = input.fallbacks.find((f) => f !== input.primary) ?? null;
  const next = input.attempt + 1;
  if (next > max) return null;
  if (fallback && input.failedModel === fallback) return null;

  if (input.failureKind === "provider") {
    if (fallback) return { attempt: next, model: fallback };
    return { attempt: next, model: input.primary };
  }
  if (next === max) return { attempt: next, model: fallback ?? input.primary };
  return { attempt: next, model: input.primary };
}

// ---------------- QA verdicts ----------------
export const CRITICAL_FLAGS = new Set([
  "warped_face",
  "warped_hands",
  "malformed_tool",
  "malformed_text",
  "background_drift",
  "signage_changed",
  "new_people_or_objects",
  "heavy_flicker",
]);

export interface ClipProbe {
  duration_s: number;
  width: number;
  height: number;
}

export interface ClipVerdict {
  overall: "pass" | "borderline" | "fail";
  flags: string[];
  reasons: string[];
}

export const PIXEL_FAIL = 0.55;
export const PIXEL_BORDERLINE = 0.7;

export function judgeClip(input: {
  scores: ClipQa | null;
  pixelSimilarity: number | null;
  probe: ClipProbe | null;
  sceneDuration: number;
}): ClipVerdict {
  const flags = new Set<string>();
  const reasons: string[] = [];
  let fail = false;
  let borderline = false;

  if (!input.probe) {
    borderline = true;
    reasons.push("Could not read clip metadata.");
  } else {
    if (input.probe.duration_s + 0.15 < input.sceneDuration) {
      fail = true;
      flags.add("too_short");
      reasons.push(`Clip is ${input.probe.duration_s.toFixed(1)}s, scene needs ${input.sceneDuration}s.`);
    }
    const shortSide = Math.min(input.probe.width, input.probe.height);
    if (shortSide < 480) {
      fail = true;
      flags.add("low_resolution");
      reasons.push(`Resolution ${input.probe.width}x${input.probe.height} is too low.`);
    }
    const ratio = input.probe.width / input.probe.height;
    if (Math.abs(ratio - 9 / 16) > 0.03) {
      borderline = true;
      flags.add("aspect_mismatch");
      reasons.push(`Clip aspect ${input.probe.width}x${input.probe.height} is not 9:16 and will be cropped.`);
    }
  }

  if (input.pixelSimilarity !== null) {
    if (input.pixelSimilarity < PIXEL_FAIL) {
      fail = true;
      flags.add("background_drift");
      reasons.push(`First frame differs from the source photo (similarity ${input.pixelSimilarity.toFixed(2)}).`);
    } else if (input.pixelSimilarity < PIXEL_BORDERLINE) {
      borderline = true;
      reasons.push(`First frame similarity to the source photo is borderline (${input.pixelSimilarity.toFixed(2)}).`);
    }
  }

  if (!input.scores) {
    borderline = true;
    reasons.push("Automated frame scoring was unavailable.");
  } else {
    const s = input.scores;
    for (const f of s.flags) {
      flags.add(f);
      if (CRITICAL_FLAGS.has(f)) fail = true;
      else borderline = true;
    }
    const vals = { fidelity: s.fidelity, hands_tools: s.hands_tools, faces: s.faces, motion: s.motion, artifacts: s.artifacts };
    for (const [k, v] of Object.entries(vals)) {
      if (v <= 2) {
        fail = true;
        reasons.push(`${k.replace("_", " ")} scored ${v}/5.`);
      } else if (v === 3) {
        borderline = true;
        reasons.push(`${k.replace("_", " ")} scored 3/5.`);
      }
    }
    if (s.fidelity < 4) flags.add("fidelity_below_4");
  }

  return { overall: fail ? "fail" : borderline ? "borderline" : "pass", flags: [...flags], reasons };
}

export interface FinalProbe {
  duration_s: number;
  width: number;
  height: number;
  has_audio: boolean;
  mean_volume_db: number | null;
  max_volume_db: number | null;
}

export function judgeFinal(probe: FinalProbe | null, expectedSeconds: number, expectAudio: boolean): ClipVerdict {
  const flags: string[] = [];
  const reasons: string[] = [];
  if (!probe) return { overall: "borderline", flags: ["probe_failed"], reasons: ["Could not read the final video."] };
  let fail = false;
  let borderline = false;
  if (Math.abs(probe.duration_s - expectedSeconds) > 0.6) {
    fail = true;
    flags.push("duration_mismatch");
    reasons.push(`Duration ${probe.duration_s.toFixed(1)}s, expected ${expectedSeconds}s.`);
  }
  if (probe.width !== 1080 || probe.height !== 1920) {
    fail = true;
    flags.push("wrong_resolution");
    reasons.push(`Resolution ${probe.width}x${probe.height}, expected 1080x1920.`);
  }
  if (expectAudio) {
    if (!probe.has_audio) {
      fail = true;
      flags.push("no_audio");
      reasons.push("No audio track.");
    } else if (probe.mean_volume_db !== null && (probe.mean_volume_db < -35 || probe.mean_volume_db > -6)) {
      borderline = true;
      flags.push("audio_level");
      reasons.push(`Mean audio level ${probe.mean_volume_db} dB is outside -35 to -6 dB.`);
    }
    if (probe.max_volume_db !== null && probe.max_volume_db >= 0) {
      borderline = true;
      flags.push("audio_clipping");
      reasons.push("Audio peaks at 0 dB (clipping).");
    }
  }
  return { overall: fail ? "fail" : borderline ? "borderline" : "pass", flags, reasons };
}

// ---------------- Pixel similarity ----------------
/** Pearson correlation of two equal-length grayscale buffers, mapped to 0..1. */
export function grayscaleSimilarity(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  let absDiff = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
    absDiff += Math.abs(a[i] - b[i]);
  }
  const corr = va === 0 || vb === 0 ? 0 : cov / Math.sqrt(va * vb);
  const meanAbs = absDiff / n / 255; // 0 identical .. 1 opposite
  // Structure (correlation) dominates; a large brightness shift lowers the score.
  // Unrelated images land near 0, a start-image clip's first frame near 0.9+.
  const score = Math.max(0, corr) * (1 - 0.5 * meanAbs);
  return Math.max(0, Math.min(1, score));
}
