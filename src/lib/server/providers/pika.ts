import "server-only";
import { billedDuration } from "../../core/storyboard-rules";
import { env } from "../env";
import { buildRequestBody, ProviderError, readError, type PollResult, type ProviderAdapter } from "./types";

// Pika developer API: https://dev.pika.art/llms.txt
// Auth: "X-API-Key". Submit POST {base}/v1/media/{vendor}/{model}/{function} -> { id }.
// Poll GET {base}/v1/media/jobs/{id}; video at output.video.url; spend in billing.charge_micro_usd.
export const pika: ProviderAdapter = {
  name: "pika",
  configured: () => !!env.pikaApiKey(),

  async submit(model, input, opts) {
    const key = env.pikaApiKey();
    if (!key) throw new ProviderError("PIKA_API_KEY is not configured.", false);
    const seconds = billedDuration(model, input.durationSeconds);
    if (seconds === null) throw new ProviderError(`${model.model_id} cannot render ${input.durationSeconds}s.`, false);
    const body = buildRequestBody(model, input, seconds);
    if (opts.webhookUrl) body.webhook_url = opts.webhookUrl;
    const res = await fetch(`${env.pikaBaseUrl()}/v1/media/${model.endpoint}`, {
      method: "POST",
      headers: { "X-API-Key": key, "Content-Type": "application/json", "Idempotency-Key": opts.idempotencyKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new ProviderError(`Pika submit failed: ${await readError(res)}`, res.status >= 500 || res.status === 429);
    const json = (await res.json()) as { id?: string };
    if (!json.id) throw new ProviderError("Pika did not return a job id.", true);
    return { requestId: json.id, body };
  },

  async poll(requestId): Promise<PollResult> {
    const key = env.pikaApiKey();
    if (!key) throw new ProviderError("PIKA_API_KEY is not configured.", false);
    const res = await fetch(`${env.pikaBaseUrl()}/v1/media/jobs/${encodeURIComponent(requestId)}`, {
      headers: { "X-API-Key": key },
      cache: "no-store",
    });
    if (!res.ok) throw new ProviderError(`Pika status failed: ${await readError(res)}`, true);
    const json = (await res.json()) as {
      status: string;
      output?: { video?: { url?: string } };
      error?: string | { message?: string };
      billing?: { state?: string; charge_micro_usd?: number } | null;
    };
    const credits =
      json.billing?.state === "settled" && typeof json.billing.charge_micro_usd === "number"
        ? Math.round(json.billing.charge_micro_usd / 100) / 100 // micro-USD -> credits ($0.01)
        : null;
    const err = typeof json.error === "string" ? json.error : json.error?.message;
    switch (json.status) {
      case "queued":
        return { status: "queued" };
      case "running":
        return { status: "in_progress" };
      case "completed":
        return json.output?.video?.url
          ? { status: "completed", videoUrl: json.output.video.url, creditsUsed: credits }
          : { status: "failed", error: "Completed without a video URL." };
      case "cancelled":
        return { status: "canceled" };
      default:
        return { status: "failed", error: err ?? `Pika status ${json.status}`, creditsUsed: credits ?? 0 };
    }
  },

  // Pika does not document a cancel endpoint; queued jobs are left to finish or fail.
  cancel: async () => false,

  downloadHeaders(url): Record<string, string> {
    const key = env.pikaApiKey();
    try {
      return key && new URL(url).host === new URL(env.pikaBaseUrl()).host ? { "X-API-Key": key } : {};
    } catch {
      return {};
    }
  },
};
