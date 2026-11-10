import "server-only";
import { billedDuration } from "../../core/storyboard-rules";
import { env } from "../env";
import { buildRequestBody, ProviderError, readError, type PollResult, type ProviderAdapter } from "./types";

// Higgsfield Platform API: https://docs.higgsfield.ai
// Auth: "Authorization: Key <id>:<secret>". Submit POST {base}/{model endpoint}.
// Poll GET {base}/requests/{id}/status. Cancel POST {base}/requests/{id}/cancel (only while queued).
export const higgsfield: ProviderAdapter = {
  name: "higgsfield",
  configured: () => !!env.higgsfieldCredentials(),

  async submit(model, input, opts) {
    const creds = env.higgsfieldCredentials();
    if (!creds) throw new ProviderError("Higgsfield credentials are not configured.", false);
    const seconds = billedDuration(model, input.durationSeconds);
    if (seconds === null) throw new ProviderError(`${model.model_id} cannot render ${input.durationSeconds}s.`, false);
    const body = buildRequestBody(model, input, seconds);
    const url = new URL(`${env.higgsfieldBaseUrl()}/${model.endpoint}`);
    if (opts.webhookUrl) url.searchParams.set("hf_webhook", opts.webhookUrl);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Key ${creds}`,
        "Content-Type": "application/json",
        "Idempotency-Key": opts.idempotencyKey,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new ProviderError(`Higgsfield submit failed: ${await readError(res)}`, res.status >= 500 || res.status === 429);
    const json = (await res.json()) as { request_id?: string };
    if (!json.request_id) throw new ProviderError("Higgsfield did not return a request_id.", true);
    return { requestId: json.request_id, body };
  },

  async poll(requestId): Promise<PollResult> {
    const creds = env.higgsfieldCredentials();
    if (!creds) throw new ProviderError("Higgsfield credentials are not configured.", false);
    const res = await fetch(`${env.higgsfieldBaseUrl()}/requests/${encodeURIComponent(requestId)}/status`, {
      headers: { Authorization: `Key ${creds}` },
      cache: "no-store",
    });
    if (!res.ok) throw new ProviderError(`Higgsfield status failed: ${await readError(res)}`, true);
    const json = (await res.json()) as { status: string; video?: { url?: string }; error?: string | { message?: string } };
    const err = typeof json.error === "string" ? json.error : json.error?.message;
    switch (json.status) {
      case "queued":
        return { status: "queued" };
      case "in_progress":
        return { status: "in_progress" };
      case "completed":
        return json.video?.url ? { status: "completed", videoUrl: json.video.url } : { status: "failed", error: "Completed without a video URL." };
      case "nsfw":
        return { status: "failed", error: "Rejected by Higgsfield content moderation." };
      case "canceled":
        return { status: "canceled" };
      default:
        return { status: "failed", error: err ?? `Higgsfield status ${json.status}` };
    }
  },

  async cancel(requestId) {
    const creds = env.higgsfieldCredentials();
    if (!creds) return false;
    const res = await fetch(`${env.higgsfieldBaseUrl()}/requests/${encodeURIComponent(requestId)}/cancel`, {
      method: "POST",
      headers: { Authorization: `Key ${creds}` },
    });
    return res.status === 202;
  },

  downloadHeaders: () => ({}),
};
