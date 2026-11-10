import "server-only";
import { randomUUID } from "node:crypto";
import type { PollResult, ProviderAdapter } from "./types";

/**
 * MEDIA_MODE=mock: records the job and lets the render service produce a local
 * ffmpeg clip from the start image. Never calls a paid API.
 */
export const mock: ProviderAdapter = {
  name: "mock",
  configured: () => true,
  async submit(_model, input) {
    return { requestId: `mock_${randomUUID()}`, body: { image: input.imageUrl, prompt: input.prompt, duration: input.durationSeconds } };
  },
  async poll(): Promise<PollResult> {
    return { status: "completed" };
  },
  cancel: async () => true,
  downloadHeaders: () => ({}),
};
