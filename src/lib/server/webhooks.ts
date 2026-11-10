import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Standard Webhooks signature check (used by Higgsfield and Pika).
 * Signed content: `${webhook-id}.${webhook-timestamp}.${body}`, HMAC-SHA256 with the
 * base64 key after the "whsec_" prefix; header holds space-separated "v1,<base64>".
 */
export function verifyStandardWebhook(secret: string, headers: Headers, body: string, toleranceSeconds = 300): boolean {
  const id = headers.get("webhook-id");
  const ts = headers.get("webhook-timestamp");
  const sigHeader = headers.get("webhook-signature");
  if (!id || !ts || !sigHeader) return false;
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > toleranceSeconds) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest();
  return sigHeader.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const given = Buffer.from(sig, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
