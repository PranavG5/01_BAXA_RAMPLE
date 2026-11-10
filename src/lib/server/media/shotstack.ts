import "server-only";
import { env } from "../env";

// Shotstack Edit API: https://shotstack.io/docs/api/  (POST /render, GET /render/{id})
function base() {
  return `https://api.shotstack.io/edit/${env.shotstackEnv()}`;
}

function key(): string {
  const k = env.shotstackApiKey();
  if (!k) throw new Error("SHOTSTACK_API_KEY is not configured.");
  return k;
}

export async function submitRender(edit: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${base()}/render`, {
    method: "POST",
    headers: { "x-api-key": key(), "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(edit),
  });
  const json = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string; response?: { id?: string } };
  if (!res.ok || !json.response?.id) throw new Error(`Shotstack render failed: ${res.status} ${json.message ?? ""}`);
  return json.response.id;
}

export interface RenderStatus {
  status: "queued" | "fetching" | "preprocessing" | "rendering" | "generating" | "saving" | "done" | "failed";
  url?: string;
  error?: string;
  duration?: number;
}

export async function renderStatus(id: string): Promise<RenderStatus> {
  const res = await fetch(`${base()}/render/${encodeURIComponent(id)}`, {
    headers: { "x-api-key": key(), Accept: "application/json" },
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { response?: RenderStatus };
  if (!res.ok || !json.response) throw new Error(`Shotstack status failed: ${res.status}`);
  return json.response;
}
