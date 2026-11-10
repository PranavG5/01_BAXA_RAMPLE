import "server-only";
import { BriefResultSchema, type BriefResult } from "../../core/schemas";
import { GOALS } from "../../core/vocabulary";
import type { Asset, BusinessProfile } from "../../types";
import { asData, structured } from "./claude";
import { libraryBlock, profileBlock } from "./context";

const SYSTEM = `You are the marketing lead for a local salon or barbershop. The owner typed a one-line idea for a short vertical video ad (Instagram Reels or TikTok). Turn it into a clear, editable creative brief.

Rules you must follow:
1. Never invent offers, prices, discounts, dates, hours, guarantees or claims. Every fact in the brief must come from the owner's prompt, the clarifying answer, or the business profile. If you are unsure, leave it out.
2. "offer" restates the offer exactly as given. Empty string if there is none.
3. "must_include_facts" lists the concrete facts the video must show or say (price, day, service, call to action), copied faithfully.
4. The goal is one of: ${GOALS.join(", ")}.
5. Default platform "both" and target length 12 to 15 seconds unless the owner says otherwise.
6. The hook idea must lead with the offer or the most striking visual from the photo library, in under 3 seconds. Never a logo or slow intro.
7. call_to_action uses the booking link or booking method from the profile when available.
8. clarifying_question: ask at most ONE short question, and only if a key fact is missing that would change the ad (for example whether a special has an end date, or which service the price applies to). Otherwise null. When asking is not allowed, return null and make the brief work without the fact.
9. Write for the business's own tone. Plain words, no hype the owner did not ask for.`;

export async function improvePrompt(input: {
  prompt: string;
  profile: BusinessProfile;
  assets: Asset[];
  clarifyingAnswer?: string | null;
  previousQuestion?: string | null;
  allowQuestion: boolean;
}): Promise<BriefResult> {
  const answer =
    input.previousQuestion && input.clarifyingAnswer
      ? `\n<clarification>\nquestion: ${asData(input.previousQuestion)}\nowner_answer: ${asData(input.clarifyingAnswer)}\n</clarification>`
      : "";
  const result = await structured({
    schema: BriefResultSchema,
    system: SYSTEM,
    effort: "medium",
    maxTokens: 8000,
    content: `${profileBlock(input.profile)}

${libraryBlock(input.assets)}

<owner_input>
${asData(input.prompt)}
</owner_input>${answer}

Asking a clarifying question is ${input.allowQuestion ? "allowed (at most one)" : "NOT allowed this time"}.
Write the brief.`,
  });
  if (!input.allowQuestion) result.clarifying_question = null;
  return result;
}
