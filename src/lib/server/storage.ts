import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "./env";
import { dataDir, serverSecret } from "./paths";

/** Local file storage under DATA_DIR/files, served through signed /api/files links. */
export type Bucket = "assets" | "media";

function fileRoot() {
  return path.join(dataDir(), "files");
}

export function localPath(bucket: Bucket, key: string): string {
  const root = path.join(fileRoot(), bucket);
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error("Invalid storage path");
  return full;
}

export async function putObject(bucket: Bucket, key: string, body: Buffer | Uint8Array, _contentType: string) {
  const full = localPath(bucket, key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, body);
  return key;
}

export async function getObject(bucket: Bucket, key: string): Promise<Buffer> {
  try {
    return await readFile(localPath(bucket, key));
  } catch {
    throw new Error(`File not found (${bucket}/${key})`);
  }
}

export async function removeObjects(bucket: Bucket, keys: (string | null | undefined)[]) {
  for (const k of keys) if (k) await rm(localPath(bucket, k), { force: true }).catch(() => undefined);
}

function signature(bucket: string, key: string, exp: number, download: string): string {
  return createHmac("sha256", serverSecret()).update(`${bucket}/${key}|${exp}|${download}`).digest("base64url");
}

export function verifyFileLink(bucket: string, key: string, exp: number, download: string, sig: string): boolean {
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  const a = Buffer.from(signature(bucket, key, exp, download));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Time-limited link to a stored file. Relative by default (for the browser);
 * absolute when an outside service (video provider, Shotstack) must fetch it.
 */
export async function signedUrl(bucket: Bucket, key: string, expiresInSeconds = 3600, download?: string, absolute = false) {
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const dl = download ?? "";
  const q = new URLSearchParams({ e: String(exp), s: signature(bucket, key, exp, dl) });
  if (dl) q.set("d", dl);
  const rel = `/api/files/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}?${q}`;
  if (!absolute) return rel;
  const base = env.appUrl() ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  if (!base) throw new Error("Set APP_URL to a public https address so video providers can fetch your photos.");
  return `${base}${rel}`;
}

export async function signedUrls(bucket: Bucket, keys: string[], expiresInSeconds = 3600, absolute = false): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const k of new Set(keys.filter(Boolean))) out.set(k, await signedUrl(bucket, k, expiresInSeconds, undefined, absolute));
  return out;
}
