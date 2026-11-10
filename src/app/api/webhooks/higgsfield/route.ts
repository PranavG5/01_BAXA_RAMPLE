import { after, NextResponse } from "next/server";
import { env } from "@/lib/server/env";
import { advanceProject, nudgeByProviderRequest } from "@/lib/server/pipeline/render";
import { verifyStandardWebhook } from "@/lib/server/webhooks";

export const maxDuration = 300;

/**
 * Completion notice from Higgsfield. Treated as a nudge only: the render service
 * re-reads the job status from Higgsfield with its own key, so a forged call
 * cannot change any state.
 */
export async function POST(req: Request) {
  const body = await req.text();
  const secret = env.higgsfieldWebhookSecret();
  if (secret && !verifyStandardWebhook(secret, req.headers, body)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  let requestId: string | undefined;
  try {
    requestId = (JSON.parse(body) as { request_id?: string }).request_id;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const projectId = requestId ? await nudgeByProviderRequest(requestId) : null;
  if (projectId) after(() => advanceProject(projectId).then(() => undefined).catch((e) => console.error("[webhook]", e)));
  return NextResponse.json({ ok: true });
}
