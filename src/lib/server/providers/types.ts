import "server-only";
import type { RegistryModel } from "../../core/routing-rules";

export interface SubmitInput {
  imageUrl: string;
  prompt: string;
  negativePrompt: string;
  durationSeconds: number;
}

export interface SubmitOptions {
  idempotencyKey: string;
  webhookUrl?: string | null;
}

export type ProviderStatus = "queued" | "in_progress" | "completed" | "failed" | "canceled";

export interface PollResult {
  status: ProviderStatus;
  videoUrl?: string;
  error?: string;
  creditsUsed?: number | null;
}

/** One interface for every video provider (PRD 4: provider adapter). */
export interface ProviderAdapter {
  name: "higgsfield" | "pika" | "mock";
  configured(): boolean;
  submit(model: RegistryModel, input: SubmitInput, opts: SubmitOptions): Promise<{ requestId: string; body: Record<string, unknown> }>;
  poll(requestId: string): Promise<PollResult>;
  cancel(requestId: string): Promise<boolean>;
  /** Headers needed to download a finished output URL from this provider, if any. */
  downloadHeaders(url: string): Record<string, string>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public retryable: boolean,
  ) {
    super(message);
  }
}

/** Map a scene onto the model's own request fields using the registry's request_config. */
export function buildRequestBody(model: RegistryModel, input: SubmitInput, billedSeconds: number): Record<string, unknown> {
  const cfg = model.request_config;
  const body: Record<string, unknown> = { ...(cfg.static ?? {}) };
  body[cfg.image_field] = input.imageUrl;
  body[cfg.prompt_field] = input.prompt;
  body[cfg.duration_field] = cfg.duration_as_string ? String(billedSeconds) : billedSeconds;
  if (cfg.negative_prompt_field && input.negativePrompt) body[cfg.negative_prompt_field] = input.negativePrompt;
  return body;
}

export async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  return `${res.status} ${res.statusText}${text ? `: ${text.slice(0, 400)}` : ""}`;
}
