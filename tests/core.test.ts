import { test } from "node:test";
import assert from "node:assert/strict";
import {
  billedDuration,
  estimateSceneCredits,
  mentionsForbiddenRendering,
  normalizeScenes,
  renderKey,
  validateStoryboard,
  type LibraryAssetLite,
} from "../src/lib/core/storyboard-rules.ts";
import { hardCandidates, isStale, sanitizeFallbacks, validatePick, type RegistryModel } from "../src/lib/core/routing-rules.ts";
import { canTransition, grayscaleSimilarity, judgeClip, judgeFinal, nextAttempt } from "../src/lib/core/pipeline-rules.ts";
import { unsupportedClaims } from "../src/lib/core/facts.ts";
import { libraryReadiness } from "../src/lib/core/library.ts";
import { buildTimeline } from "../src/lib/core/timeline.ts";
import type { SceneDraft } from "../src/lib/core/schemas.ts";

const lib = new Map<string, LibraryAssetLite>([
  ["a1", { id: "a1", usable: true, area: "chair_mirror", faces_visible: false }],
  ["a2", { id: "a2", usable: true, area: "workstation", faces_visible: false }],
  ["a3", { id: "a3", usable: true, area: "storefront", faces_visible: false }],
]);

function scene(p: Partial<SceneDraft>): SceneDraft {
  return {
    order: 1,
    role: "showcase",
    duration_s: 3,
    background_asset_id: "a1",
    treatment: "still_motion",
    shot_type: "wide",
    motion_prompt: "",
    subject_description: null,
    still_motion_effect: "zoomInSlow",
    voiceover: "",
    on_screen_text: "",
    ...p,
  };
}

const good: SceneDraft[] = [
  scene({ order: 1, role: "hook", duration_s: 3, treatment: "animate", shot_type: "over_the_shoulder", motion_prompt: "Slow push in on clippers working, no text or logos.", on_screen_text: "$25 Fades Tuesdays", voiceover: "Twenty-five dollar fades, every Tuesday." }),
  scene({ order: 2, duration_s: 4, background_asset_id: "a2", on_screen_text: "Sharp every time" }),
  scene({ order: 3, role: "proof", duration_s: 3, background_asset_id: "a3" }),
  scene({ order: 4, role: "cta", duration_s: 3, treatment: "end_card", background_asset_id: "a3", on_screen_text: "Book now" }),
];

test("valid storyboard passes", () => {
  const r = validateStoryboard(good, lib, { offer: "$25 fades on Tuesdays" });
  assert.deepEqual(r.errors, []);
});

test("hook rules: required, <= 3s, not an end card", () => {
  const bad = good.map((s, i) => (i === 0 ? { ...s, duration_s: 4.5 } : s));
  assert.ok(validateStoryboard(bad, lib).errors.some((e) => e.includes("hook must last")));
  const noHook = good.map((s, i) => (i === 0 ? { ...s, role: "showcase" as const } : s));
  assert.ok(validateStoryboard(noHook, lib).errors.some((e) => e.includes("Scene 1 must be the hook")));
});

test("every scene needs a real background photo", () => {
  const bad = good.map((s, i) => (i === 1 ? { ...s, background_asset_id: "nope" } : s));
  assert.ok(validateStoryboard(bad, lib).errors.some((e) => e.includes("not in the library")));
});

test("video model is never asked to render text, prices or logos", () => {
  assert.equal(mentionsForbiddenRendering("Slow push, no text or logos"), null);
  assert.equal(mentionsForbiddenRendering("Camera pans across the shop without any text"), null);
  assert.ok(mentionsForbiddenRendering("Neon sign showing $25"));
  assert.ok(mentionsForbiddenRendering("Logo spins in"));
  const bad = good.map((s, i) => (i === 0 ? { ...s, motion_prompt: "Price tag reading $25 appears" } : s));
  assert.ok(validateStoryboard(bad, lib).errors.some((e) => e.includes("assembly only")));
});

test("scene count and end card placement", () => {
  assert.ok(validateStoryboard(good.slice(0, 2), lib).errors.length > 0);
  const swapped = [good[0], good[3], good[1], good[2]].map((s, i) => ({ ...s, order: i + 1 }));
  assert.ok(validateStoryboard(swapped, lib).errors.some((e) => e.includes("end card must be the last")));
});

test("normalizeScenes renumbers and clears motion prompt on non-animated scenes", () => {
  const n = normalizeScenes([{ ...good[1], order: 7, motion_prompt: "x" }, { ...good[0], order: 2 }]);
  assert.deepEqual(n.map((s) => s.order), [1, 2]);
  assert.equal(n[1].motion_prompt, "");
  assert.equal(n[0].still_motion_effect, null);
});

test("render key ignores text-only edits (FR-22)", () => {
  const k1 = renderKey(good[0]);
  assert.equal(renderKey({ ...good[0], on_screen_text: "changed", voiceover: "changed" } as SceneDraft), k1);
  assert.notEqual(renderKey({ ...good[0], duration_s: 2.5 }), k1);
});

const model = (p: Partial<RegistryModel>): RegistryModel => ({
  model_id: "m",
  provider: "pika",
  endpoint: "x",
  display_name: "M",
  status: "usable",
  status_reason: "",
  enabled: true,
  pros: "",
  cons: "",
  best_for: [],
  avoid_for: [],
  start_image_support: true,
  min_duration_s: 3,
  max_duration_s: 15,
  allowed_durations: null,
  aspect_ratios: ["9:16"],
  resolution: "720p",
  cost_credits_per_second: 2,
  latency_s: 60,
  prompt_guidelines: "",
  request_config: { image_field: "image", prompt_field: "prompt", duration_field: "duration" },
  evidence_links: [],
  evaluated_on: null,
  evaluator: "",
  registry_version: 1,
  ...p,
});

test("billed duration and credit estimate", () => {
  assert.equal(billedDuration(model({}), 2.5), 3);
  assert.equal(billedDuration(model({ allowed_durations: [5, 10] }), 3), 5);
  assert.equal(billedDuration(model({ max_duration_s: 5 }), 6), null);
  assert.equal(estimateSceneCredits(model({}), 4, "animate"), 8);
  assert.equal(estimateSceneCredits(model({}), 4, "still_motion"), 0);
});

test("hard constraints filter candidates", () => {
  const ms = [
    model({ model_id: "ok" }),
    model({ model_id: "disabled", enabled: false }),
    model({ model_id: "unusable", status: "not_usable" }),
    model({ model_id: "noimg", start_image_support: false }),
    model({ model_id: "landscape", aspect_ratios: ["16:9"] }),
    model({ model_id: "short", max_duration_s: 2 }),
  ];
  const c = hardCandidates({ order: 1, duration_s: 3, treatment: "animate", shot_type: "wide" }, ms);
  assert.deepEqual(c.map((m) => m.model_id), ["ok"]);
});

test("pick validation and fallback sanitizing", () => {
  const cands = [model({ model_id: "a", cost_credits_per_second: 5 }), model({ model_id: "b", cost_credits_per_second: 1 })];
  assert.ok(validatePick({ model_id: "a", fallback: ["b"] }, cands).ok);
  assert.ok(!validatePick({ model_id: "zzz", fallback: [] }, cands).ok);
  assert.ok(!validatePick({ model_id: null, fallback: [] }, cands).ok);
  assert.ok(validatePick({ model_id: null, fallback: [] }, []).ok);
  assert.deepEqual(sanitizeFallbacks("a", ["a", "x"], cands), ["b"]);
});

test("stale registry entries are flagged", () => {
  const now = new Date("2026-11-10T00:00:00Z");
  assert.ok(isStale({ evaluated_on: null }, 60, now));
  assert.ok(isStale({ evaluated_on: "2026-08-01" }, 60, now));
  assert.ok(!isStale({ evaluated_on: "2026-10-20" }, 60, now));
});

test("state machine", () => {
  assert.ok(canTransition("draft", "approved"));
  assert.ok(!canTransition("draft", "rendering"));
  assert.ok(!canTransition("complete", "rendering"));
});

test("retry policy: fallback on last attempt and after provider failure", () => {
  const base = { primary: "p", fallbacks: ["f"] };
  assert.deepEqual(nextAttempt({ ...base, attempt: 1, failureKind: "qa", failedModel: "p" }), { attempt: 2, model: "p" });
  assert.deepEqual(nextAttempt({ ...base, attempt: 2, failureKind: "qa", failedModel: "p" }), { attempt: 3, model: "f" });
  assert.equal(nextAttempt({ ...base, attempt: 3, failureKind: "qa", failedModel: "f" }), null);
  assert.deepEqual(nextAttempt({ ...base, attempt: 1, failureKind: "provider", failedModel: "p" }), { attempt: 2, model: "f" });
  assert.equal(nextAttempt({ ...base, attempt: 2, failureKind: "provider", failedModel: "f" }), null);
});

test("QA verdicts", () => {
  const scores = { fidelity: 5, hands_tools: 5, faces: 5, motion: 4, artifacts: 5, flags: [], summary: "" };
  const probe = { duration_s: 5, width: 720, height: 1280 };
  assert.equal(judgeClip({ scores, pixelSimilarity: 0.95, probe, sceneDuration: 3 }).overall, "pass");
  assert.equal(judgeClip({ scores: { ...scores, hands_tools: 2 }, pixelSimilarity: 0.95, probe, sceneDuration: 3 }).overall, "fail");
  assert.equal(judgeClip({ scores: { ...scores, motion: 3 }, pixelSimilarity: 0.95, probe, sceneDuration: 3 }).overall, "borderline");
  assert.equal(judgeClip({ scores: { ...scores, flags: ["warped_hands"] }, pixelSimilarity: 0.95, probe, sceneDuration: 3 }).overall, "fail");
  assert.equal(judgeClip({ scores, pixelSimilarity: 0.3, probe, sceneDuration: 3 }).overall, "fail");
  assert.equal(judgeClip({ scores, pixelSimilarity: 0.95, probe: { ...probe, duration_s: 2 }, sceneDuration: 3 }).overall, "fail");
  assert.equal(judgeClip({ scores: null, pixelSimilarity: null, probe: null, sceneDuration: 3 }).overall, "borderline");
});

test("final QA checks duration, 9:16 resolution and audio", () => {
  const ok = { duration_s: 13, width: 1080, height: 1920, has_audio: true, mean_volume_db: -18, max_volume_db: -1.5 };
  assert.equal(judgeFinal(ok, 13, true).overall, "pass");
  assert.equal(judgeFinal({ ...ok, width: 1920, height: 1080 }, 13, true).overall, "fail");
  assert.equal(judgeFinal({ ...ok, has_audio: false }, 13, true).overall, "fail");
  assert.equal(judgeFinal({ ...ok, mean_volume_db: -45 }, 13, true).overall, "borderline");
});

test("pixel similarity separates same and unrelated images", () => {
  const n = 64 * 36;
  const a = new Uint8Array(n).map((_, i) => (i * 37) % 251);
  const same = a.map((v) => Math.min(255, v + 4));
  let seed = 7;
  const noise = new Uint8Array(n).map(() => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % 256));
  assert.ok(grayscaleSimilarity(a, same) > 0.9);
  assert.ok(grayscaleSimilarity(a, noise) < 0.55);
});

test("fact guard catches invented prices and days", () => {
  const sources = ["$25 Tuesday Fade special", "Services: Fade $30, Beard trim $15"];
  assert.deepEqual(unsupportedClaims("$25 fades every Tuesday", sources), []);
  assert.deepEqual(unsupportedClaims("Fade for 25 dollars, beard $15", sources), []);
  assert.deepEqual(unsupportedClaims("$20 fades on Fridays, 10% off", sources).sort(), ["$20", "10%", "friday"].sort());
});

test("library readiness requires 6 tagged photos in 4 areas", () => {
  const mk = (id: string, area: string) => ({ id, area, shot_slot: area, usable: true, tag_status: "tagged" });
  const five = ["storefront", "sign", "workstation", "chair_mirror", "chair_mirror"].map((a, i) => mk(String(i), a));
  assert.equal(libraryReadiness(five).ready, false);
  assert.equal(libraryReadiness([...five, mk("6", "interior_wide")]).ready, true);
  assert.equal(libraryReadiness(["sign", "sign", "sign", "sign", "sign", "sign"].map((a, i) => mk(String(i), a))).ready, false);
});

test("timeline: 9:16 output, text only in overlays, muted clips, end card last", () => {
  const edit = buildTimeline({
    scenes: [
      { order: 1, role: "hook", duration_s: 3, treatment: "animate", visualUrl: "https://x/clip.mp4", stillEffect: null, onScreenText: "$25 Fades", voiceoverText: "Hi", voiceoverUrl: "https://x/vo1.mp3", voiceoverSeconds: 1.2 },
      { order: 2, role: "showcase", duration_s: 4, treatment: "still_motion", visualUrl: "https://x/p.jpg", stillEffect: "zoomInSlow", onScreenText: "", voiceoverText: "", voiceoverUrl: null, voiceoverSeconds: null },
      { order: 3, role: "cta", duration_s: 3, treatment: "end_card", visualUrl: "https://x/p2.jpg", stillEffect: "zoomOutSlow", onScreenText: "Book today", voiceoverText: "", voiceoverUrl: null, voiceoverSeconds: null },
    ],
    businessName: "Test Barbers",
    bookingText: "book.example.com",
    brandPrimary: "#112233",
    brandAccent: "nothex",
    logoUrl: "https://x/logo.png",
    musicUrl: "https://x/music.mp3",
    captions: true,
    fontFamily: "Open Sans",
  }) as { output: { size: { width: number; height: number } }; timeline: { tracks: { clips: Record<string, any>[] }[] } };
  assert.deepEqual(edit.output.size, { width: 1080, height: 1920 });
  const clips = edit.timeline.tracks.flatMap((t) => t.clips);
  const video = clips.find((c) => c.asset.type === "video");
  assert.equal(video?.asset.volume, 0);
  const texts = clips.filter((c) => c.asset.type === "rich-text").map((c) => c.asset.text);
  assert.ok(texts.includes("$25 Fades") && texts.includes("Book today") && texts.includes("book.example.com"));
  const visuals = clips.filter((c) => c.asset.type === "video" || (c.asset.type === "image" && c.effect));
  assert.deepEqual(visuals.map((c) => c.start), [0, 3, 7]);
});
