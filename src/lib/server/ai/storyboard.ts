import "server-only";
import {
  ReviseResultSchema,
  StoryboardDraftSchema,
  type Brief,
  type ReviseResult,
  type SceneDraft,
  type StoryboardDraft,
} from "../../core/schemas";
import { normalizeScenes, validateStoryboard, type LibraryAssetLite } from "../../core/storyboard-rules";
import { SHOT_TYPES, STILL_EFFECTS, STORYBOARD_LIMITS as L } from "../../core/vocabulary";
import type { Asset, BusinessProfile } from "../../types";
import { asData, structured } from "./claude";
import { libraryBlock, profileBlock } from "./context";

const TEMPLATES = `Structure: Hook, Showcase, Proof, CTA (3 to 5 scenes, ${L.targetMinSeconds} to ${L.targetMaxSeconds} seconds total).
Variations by goal:
- promo: Hook states the offer over the strongest visual. Showcase the service. Proof is a finished result. CTA end card with booking.
- new_service: Hook teases the result. Showcase the service in action (hands, tools). Proof shows the finished look. CTA.
- before_after: Hook is the most striking result. Showcase the process. Proof is the finished result from a second angle. CTA.
- brand_awareness: Hook is the most inviting space shot. Showcase craft details. Proof is the vibe of the shop. CTA.
- event: Hook states what and when. Showcase the space. CTA with date and booking.`;

const SYSTEM = `You are a short-form video editor for salons and barbershops. You write storyboards that present what the business already has. The AI imagines as little as possible.

${TEMPLATES}

Hard rules (output that breaks these is rejected):
1. Every scene uses a background_asset_id from the photo library. Use only listed ids. Prefer photos with usable=true.
2. Scene 1 is the hook: role "hook", ${L.hookMaxSeconds} seconds or less, leads with the offer or the most striking visual. Never a logo or slow intro, never an end card.
3. Treatments:
   - "animate": an image-to-video model animates the photo (costs credits). Use it for the 1 to 3 scenes where motion matters most.
   - "still_motion": a free pan or zoom on the photo, built in assembly. Use still_motion_effect from: ${STILL_EFFECTS.join(", ")}.
   - "end_card": the free closing card (logo, call to action, booking link) built in assembly over a darkened photo. At most one, always last.
4. Text rule: the video model never renders text, prices or logos. motion_prompt must not mention them. All words on screen go in on_screen_text, which is added in assembly.
5. motion_prompt (animate scenes only, empty otherwise) describes only what moves: one camera move and at most one subject motion, slow and realistic. End it with: "The background stays exactly as in the photo."
6. Shot rule: prefer over-the-shoulder, from-behind, hands-and-hair close-ups and environment motion. Animating a visible face doing complex actions is a last resort. Do not invent new people.
7. shot_type is one of: ${SHOT_TYPES.join(", ")}.
8. on_screen_text: short and readable on a phone (under 48 characters). Copy prices and days exactly from the brief.
9. voiceover: natural spoken line that fits the scene duration (about ${L.wordsPerSecond} words per second). May be empty for some scenes.
10. Durations in seconds, in steps of 0.5. Never invent offers, prices or claims not in the brief or profile.`;

function libraryMap(assets: Asset[]): Map<string, LibraryAssetLite> {
  return new Map(
    assets
      .filter((a) => a.tag_status === "tagged")
      .map((a) => [a.id, { id: a.id, usable: a.usable, area: a.area, faces_visible: a.faces_visible, description: a.description }]),
  );
}

function briefBlock(brief: Brief): string {
  return `<brief>\n${asData(JSON.stringify(brief, null, 2))}\n</brief>`;
}

export interface StoryboardOutcome<T> {
  result: T;
  scenes: SceneDraft[];
  warnings: string[];
}

async function withValidation<T extends { scenes: SceneDraft[] }>(
  call: (feedback: string) => Promise<T>,
  assets: Asset[],
  brief: Brief,
): Promise<StoryboardOutcome<T>> {
  const lib = libraryMap(assets);
  let feedback = "";
  let lastErrors: string[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await call(feedback);
    const scenes = normalizeScenes(result.scenes);
    const { errors, warnings } = validateStoryboard(scenes, lib, { offer: brief.offer });
    if (errors.length === 0) return { result, scenes, warnings };
    lastErrors = errors;
    feedback = `\n\nYour previous storyboard was rejected by the validator. Fix every problem:\n- ${errors.join("\n- ")}`;
  }
  throw new Error(`Storyboard failed validation after 3 attempts: ${lastErrors.join(" ")}`);
}

export async function draftStoryboard(input: {
  brief: Brief;
  profile: BusinessProfile;
  assets: Asset[];
}): Promise<StoryboardOutcome<StoryboardDraft>> {
  return withValidation(
    (feedback) =>
      structured({
        schema: StoryboardDraftSchema,
        system: SYSTEM,
        effort: "high",
        content: `${profileBlock(input.profile)}

${libraryBlock(input.assets)}

${briefBlock(input.brief)}

Write the storyboard.${feedback}`,
      }),
    input.assets,
    input.brief,
  );
}

export async function reviseStoryboard(input: {
  brief: Brief;
  profile: BusinessProfile;
  assets: Asset[];
  current: SceneDraft[];
  musicMood: string;
  message: string;
}): Promise<StoryboardOutcome<ReviseResult>> {
  const current = JSON.stringify({ scenes: input.current, music_mood: input.musicMood }, null, 2);
  return withValidation(
    (feedback) =>
      structured({
        schema: ReviseResultSchema,
        system: `${SYSTEM}

You are revising an existing storyboard based on the owner's request. Change only what the request needs. Keep every other scene exactly as it is (same photo, treatment, motion prompt, durations and text), so unchanged scenes do not need to be re-rendered.`,
        effort: "medium",
        content: `${profileBlock(input.profile)}

${libraryBlock(input.assets)}

${briefBlock(input.brief)}

<current_storyboard>
${asData(current)}
</current_storyboard>

<owner_input>
${asData(input.message)}
</owner_input>

Return the full revised storyboard.${feedback}`,
      }),
    input.assets,
    input.brief,
  );
}
