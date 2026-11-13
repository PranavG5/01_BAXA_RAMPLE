import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";
import { dataDir, serverSecret, supabaseStorageConfig } from "./paths";

/**
 * File storage. Uses Supabase Storage (private buckets "assets" and "media",
 * created on first use) when SUPABASE_URL and a secret key are set; links are
 * Supabase signed URLs. Otherwise local files under DATA_DIR/files, served
 * through signed /api/files links.
 */
export type Bucket = "assets" | "media";

const sg = globalThis as unknown as { __rampleStorage?: SupabaseClient; __rampleBuckets?: Map<string, Promise<void>> };

function supabase(): SupabaseClient | null {
  const cfg = supabaseStorageConfig();
  if (!cfg) return null;
  sg.__rampleStorage ??= createClient(cfg.url, cfg.key, { auth: { persistSession: false, autoRefreshToken: false } });
  return sg.__rampleStorage;
}

/** Creates the private bucket the first time it is needed. */
function ensureBucket(client: SupabaseClient, bucket: Bucket): Promise<void> {
  sg.__rampleBuckets ??= new Map();
  let p = sg.__rampleBuckets.get(bucket);
  if (!p) {
    p = (async () => {
      const { error } = await client.storage.getBucket(bucket);
      if (!error) return;
      const created = await client.storage.createBucket(bucket, { public: false });
      if (created.error && !/already exists/i.test(created.error.message)) {
        throw new Error(`Could not create storage bucket "${bucket}": ${created.error.message}`);
      }
    })();
    p.catch(() => sg.__rampleBuckets?.delete(bucket));
    sg.__rampleBuckets.set(bucket, p);
  }
  return p;
}

async function storageFor(bucket: Bucket) {
  const client = supabase();
  if (!client) return null;
  await ensureBucket(client, bucket);
  return client.storage.from(bucket);
}

function checkKey(key: string) {
  if (!key || key.startsWith("/") || key.split("/").some((part) => part === ".." || part === "")) throw new Error("Invalid storage path");
}

function fileRoot() {
  return path.join(dataDir(), "files");
}

export function localPath(bucket: Bucket, key: string): string {
  const root = path.join(fileRoot(), bucket);
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error("Invalid storage path");
  return full;
}

/**
 * A one-time link the browser can PUT a file to, straight into Supabase
 * Storage. This keeps large photos out of the app's own requests, which
 * Vercel caps at 4.5 MB. Null with local storage (no such cap there).
 */
export async function createUploadTarget(bucket: Bucket, key: string): Promise<{ url: string } | null> {
  checkKey(key);
  const store = await storageFor(bucket);
  if (!store) return null;
  const { data, error } = await store.createSignedUploadUrl(key);
  if (error || !data) throw new Error(`Could not prepare the upload: ${error?.message ?? "unknown error"}`);
  return { url: data.signedUrl };
}

export async function putObject(bucket: Bucket, key: string, body: Buffer | Uint8Array, contentType: string) {
  checkKey(key);
  const store = await storageFor(bucket);
  if (store) {
    const { error } = await store.upload(key, Buffer.from(body), { contentType, upsert: true });
    if (error) throw new Error(`Could not save file (${bucket}/${key}): ${error.message}`);
    return key;
  }
  const full = localPath(bucket, key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, body);
  return key;
}

export async function getObject(bucket: Bucket, key: string): Promise<Buffer> {
  checkKey(key);
  const store = await storageFor(bucket);
  if (store) {
    const { data, error } = await store.download(key);
    if (error || !data) throw new Error(`File not found (${bucket}/${key})`);
    return Buffer.from(await data.arrayBuffer());
  }
  try {
    return await readFile(localPath(bucket, key));
  } catch {
    throw new Error(`File not found (${bucket}/${key})`);
  }
}

export async function removeObjects(bucket: Bucket, keys: (string | null | undefined)[]) {
  const store = await storageFor(bucket);
  if (store) {
    const paths = keys.filter((k): k is string => !!k);
    if (paths.length) {
      const { error } = await store.remove(paths);
      if (error) console.error("[storage] delete failed", bucket, error.message);
    }
    return;
  }
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
  const store = await storageFor(bucket);
  if (store) {
    const { data, error } = await store.createSignedUrl(key, expiresInSeconds, download ? { download } : undefined);
    if (error || !data) throw new Error(`Could not link file (${bucket}/${key}): ${error?.message ?? "unknown error"}`);
    return data.signedUrl;
  }
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
  const store = await storageFor(bucket);
  if (store) {
    const unique = [...new Set(keys.filter(Boolean))];
    if (!unique.length) return out;
    const { data, error } = await store.createSignedUrls(unique, expiresInSeconds);
    if (error) throw new Error(`Could not link files (${bucket}): ${error.message}`);
    for (const d of data ?? []) if (d.path && d.signedUrl && !d.error) out.set(d.path, d.signedUrl);
    return out;
  }
  for (const k of new Set(keys.filter(Boolean))) out.set(k, await signedUrl(bucket, k, expiresInSeconds, undefined, absolute));
  return out;
}
