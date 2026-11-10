import "server-only";
import { ClipQaSchema, QA_FLAGS, type ClipQa } from "../../core/schemas";
import { env } from "../env";
import { asData, imageBlock, structured, textBlock } from "./claude";

const SYSTEM = `You are the quality checker for AI-animated scenes in short salon and barbershop ads. A video model animated a real photo of the business. You see the source photo first, then frames sampled from the clip in time order.

Score 1 to 5 (5 is best):
- fidelity: does the background stay the same as the source photo (walls, mirrors, chairs, signage, layout)? Camera movement is fine; changed or invented objects are not.
- hands_tools: realism of hands, hair, clippers, scissors and combs. Score 5 if none are visible.
- faces: realism of any faces. Score 5 if none are visible.
- motion: does it look like real footage with smooth, plausible motion?
- artifacts: 5 means no glitches, melting, flicker or smearing.

Flags (only when clearly present): ${QA_FLAGS.join(", ")}.
malformed_text means the model drew or changed letters, numbers or signage.

Be strict. Local business owners will publish this. A warped hand or changed sign is a failure.`;

export async function scoreClip(input: {
  sourceJpegBase64: string;
  frames: { atSeconds: number; jpegBase64: string }[];
  sceneDescription: string;
}): Promise<ClipQa> {
  return structured({
    schema: ClipQaSchema,
    system: SYSTEM,
    model: env.anthropicQaModel(),
    effort: "medium",
    maxTokens: 4000,
    content: [
      textBlock("Source photo:"),
      imageBlock(input.sourceJpegBase64),
      ...input.frames.flatMap((f) => [textBlock(`Frame at ${f.atSeconds.toFixed(1)}s:`), imageBlock(f.jpegBase64)]),
      textBlock(`<scene_intent>${asData(input.sceneDescription)}</scene_intent>\nScore this clip.`),
    ],
  });
}
