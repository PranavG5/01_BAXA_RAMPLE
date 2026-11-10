import { after, NextResponse } from "next/server";
import { env } from "@/lib/server/env";
import { advanceProject, nudgeByProviderRequest } from "@/lib/server/pipeline/render";
import { verifyStandardWebhook } from "@/lib/server/webhooks";

export const maxDuration = 300;

/** Completion notice from Pika. A nudge only; status is re-read from Pika. */
export async function POST(req: Request) {
  const body = await req.text();
  const secret = env.pikaWebhookSecret();
  if (secret && !verifyStandardWebhook(secret, req.headers, body)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  let requestId: string | undefined;
  try {
    const json = JSON.parse(body) as { id?: string; request_id?: string; data?: { id?: string } };
    requestId = json.id ?? json.request_id ?? json.data?.id;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const projectId = requestId ? await nudgeByProviderRequest(requestId) : null;
  if (projectId) after(() => advanceProject(projectId).then(() => undefined).catch((e) => console.error("[webhook]", e)));
  return NextResponse.json({ ok: true });
}
