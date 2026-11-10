import "server-only";
import { TagResultSchema, type TagResult } from "../../core/schemas";
import { MOTION_TAGS, REQUIRED_SHOTS } from "../../core/vocabulary";
import { structured, imageBlock, textBlock } from "./claude";

const SYSTEM = `You tag photos for a salon and barbershop video tool. Each photo becomes the fixed background of a short vertical ad, so your tags decide which scenes it can anchor.

Return:
- area: which part of the business the photo shows.
- angle: the camera angle.
- subject and a one-sentence description an editor could use to pick this shot.
- shot_slot: the onboarding slot this photo fills (${REQUIRED_SHOTS.map((s) => s.slot).join(", ")}) or "none".
- people_visible / faces_visible (a clearly recognizable face) / text_visible (readable signage or prices).
- quality_issues: only real problems that would hurt a video.
- animation_suitability: how well an image-to-video model could animate this photo without inventing things (good: clear scene with room for a camera push or natural motion; poor: cluttered, blurry, text-heavy or a collage).
- suitable_motion_tags: from this fixed vocabulary only: ${MOTION_TAGS.join(", ")}.

Be literal. Describe only what is visible.`;

export async function tagPhoto(analysisJpegBase64: string, meta: { width: number; height: number; filename: string }): Promise<TagResult> {
  return structured({
    schema: TagResultSchema,
    system: SYSTEM,
    effort: "low",
    maxTokens: 4000,
    content: [
      imageBlock(analysisJpegBase64),
      textBlock(`<photo_metadata>original size ${meta.width}x${meta.height}</photo_metadata>\nTag this photo.`),
    ],
  });
}
