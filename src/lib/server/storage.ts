import "server-only";
import { db } from "./supabase";

export type Bucket = "assets" | "media";

export async function putObject(bucket: Bucket, path: string, body: Buffer | Uint8Array, contentType: string) {
  const { error } = await db().storage.from(bucket).upload(path, body, { contentType, upsert: true });
  if (error) throw new Error(`Storage upload failed (${bucket}/${path}): ${error.message}`);
  return path;
}

export async function getObject(bucket: Bucket, path: string): Promise<Buffer> {
  const { data, error } = await db().storage.from(bucket).download(path);
  if (error || !data) throw new Error(`Storage download failed (${bucket}/${path}): ${error?.message}`);
  return Buffer.from(await data.arrayBuffer());
}

export async function removeObjects(bucket: Bucket, paths: (string | null | undefined)[]) {
  const clean = paths.filter((p): p is string => !!p);
  if (!clean.length) return;
  const { error } = await db().storage.from(bucket).remove(clean);
  if (error) console.warn(`Storage remove failed (${bucket}): ${error.message}`);
}

/** Short-lived signed URL. Providers and the assembler fetch through these. */
export async function signedUrl(bucket: Bucket, path: string, expiresInSeconds = 3600, download?: string) {
  const { data, error } = await db()
    .storage.from(bucket)
    .createSignedUrl(path, expiresInSeconds, download ? { download } : undefined);
  if (error || !data) throw new Error(`Could not sign ${bucket}/${path}: ${error?.message}`);
  return data.signedUrl;
}

export async function signedUrls(bucket: Bucket, paths: string[], expiresInSeconds = 3600): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return out;
  const { data, error } = await db().storage.from(bucket).createSignedUrls(unique, expiresInSeconds);
  if (error || !data) throw new Error(`Could not sign URLs: ${error?.message}`);
  for (const row of data) if (row.path && row.signedUrl) out.set(row.path, row.signedUrl);
  return out;
}
