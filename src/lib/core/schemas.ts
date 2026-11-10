// Zod schemas for every structured Claude output. They are kept free of numeric
// constraints so they translate cleanly into structured-output JSON schemas;
// business rules are enforced afterwards in storyboard-rules / routing-rules.
import { z } from "zod";
import {
  ANGLES,
  AREAS,
  GOALS,
  MOTION_TAGS,
  PLATFORMS,
  QUALITY_ISSUES,
  SCENE_ROLES,
  SHOT_TYPES,
  STILL_EFFECTS,
  TREATMENTS,
} from "./vocabulary.ts";

// ---------- Photo tagging (FR-2) ----------
export const TagResultSchema = z.object({
  area: z.enum(AREAS),
  angle: z.enum(ANGLES),
  subject: z.string().describe("Short noun phrase: what the photo mainly shows."),
  description: z.string().describe("One sentence describing the photo for a video editor."),
  shot_slot: z.enum([...AREAS, "none"] as const).describe("Which onboarding slot this photo fills, or none."),
  people_visible: z.boolean(),
  faces_visible: z.boolean().describe("True if any human face is clearly recognizable."),
  text_visible: z.boolean().describe("True if signage, prices or other text is readable."),
  quality_issues: z.array(z.enum(QUALITY_ISSUES)),
  animation_suitability: z.enum(["good", "fair", "poor"]),
  suitable_motion_tags: z.array(z.enum(MOTION_TAGS)),
});
export type TagResult = z.infer<typeof TagResultSchema>;

// ---------- Prompt improvement (FR-5, PRD 6.1) ----------
export const BriefSchema = z.object({
  title: z.string().describe("Short internal name for this video, e.g. '$25 Tuesday Fade Reel'."),
  goal: z.enum(GOALS),
  offer: z.string().describe("The offer exactly as stated by the owner or profile. Empty if none."),
  audience: z.string(),
  tone: z.string(),
  platform: z.enum(PLATFORMS),
  target_length_s: z.number(),
  hook_idea: z.string(),
  must_include_facts: z.array(z.string()).describe("Facts copied from the prompt or profile: price, day, CTA."),
  call_to_action: z.string(),
  notes: z.string(),
});
export type Brief = z.infer<typeof BriefSchema>;

export const BriefResultSchema = z.object({
  brief: BriefSchema,
  clarifying_question: z
    .string()
    .nullable()
    .describe("At most one question about a missing key fact, or null if nothing important is missing."),
});
export type BriefResult = z.infer<typeof BriefResultSchema>;

// ---------- Storyboard (FR-6, PRD 6.3) ----------
export const SceneDraftSchema = z.object({
  order: z.number(),
  role: z.enum(SCENE_ROLES),
  duration_s: z.number(),
  background_asset_id: z.string().describe("Must be one of the photo ids in the library."),
  treatment: z.enum(TREATMENTS),
  shot_type: z.enum(SHOT_TYPES),
  motion_prompt: z
    .string()
    .describe("What moves. For animate scenes only; empty string otherwise. Never ask for text, prices or logos."),
  subject_description: z.string().nullable(),
  still_motion_effect: z.enum(STILL_EFFECTS).nullable().describe("For still_motion and end_card scenes."),
  voiceover: z.string(),
  on_screen_text: z.string(),
});
export type SceneDraft = z.infer<typeof SceneDraftSchema>;

export const StoryboardDraftSchema = z.object({
  scenes: z.array(SceneDraftSchema),
  music_mood: z.string(),
  rationale: z.string().describe("Two sentences on why this structure fits the brief."),
});
export type StoryboardDraft = z.infer<typeof StoryboardDraftSchema>;

export const ReviseResultSchema = z.object({
  scenes: z.array(SceneDraftSchema),
  music_mood: z.string(),
  change_summary: z.string().describe("One sentence the owner will read describing what changed."),
});
export type ReviseResult = z.infer<typeof ReviseResultSchema>;

// ---------- Router (FR-12, PRD 5.5) ----------
export const RouterDecisionSchema = z.object({
  scene_order: z.number(),
  model_id: z.string().nullable().describe("A model_id from this scene's candidate list, or null if none fits."),
  reason: z.string().describe("One sentence."),
  fallback: z.array(z.string()).describe("Ranked fallback model_ids from the same candidate list."),
  confidence: z.enum(["high", "medium", "low"]),
  model_prompt: z
    .string()
    .describe("Final motion prompt for the chosen model, following its prompt_guidelines. No text, prices or logos."),
});
export const RouterOutputSchema = z.object({ decisions: z.array(RouterDecisionSchema) });
export type RouterDecisionOut = z.infer<typeof RouterDecisionSchema>;

// ---------- QA (FR-25, FR-26) ----------
export const QA_FLAGS = [
  "warped_face",
  "warped_hands",
  "malformed_tool",
  "malformed_text",
  "background_drift",
  "signage_changed",
  "new_people_or_objects",
  "heavy_flicker",
  "frozen_or_no_motion",
  "unnatural_motion",
] as const;

export const ClipQaSchema = z.object({
  fidelity: z.number().describe("1-5: background stays the same as the source photo."),
  hands_tools: z.number().describe("1-5: realism of hands, hair and tools. 5 if none visible."),
  faces: z.number().describe("1-5: realism of faces. 5 if no faces visible."),
  motion: z.number().describe("1-5: motion quality and smoothness."),
  artifacts: z.number().describe("1-5: 5 means no glitches or artifacts."),
  flags: z.array(z.enum(QA_FLAGS)),
  summary: z.string().describe("One sentence for a human reviewer."),
});
export type ClipQa = z.infer<typeof ClipQaSchema>;
