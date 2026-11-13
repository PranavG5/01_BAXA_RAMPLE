import "server-only";
import { createHmac } from "node:crypto";
import path from "node:path";

/** Hosted Postgres connection string. Vercel's Neon and Supabase integrations set one of these. */
export function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim() || undefined;
}

/** A Vercel Blob store is connected (Vercel sets one of these when you connect a store to the project). */
export function blobConfigured(): boolean {
  return !!(process.env.BLOB_READ_WRITE_TOKEN?.trim() || process.env.BLOB_STORE_ID?.trim());
}

/**
 * True when uploads and the database only live in this server instance's /tmp,
 * so other instances (and later requests) cannot see them.
 */
export function storageIsTemporary(): boolean {
  return !!process.env.VERCEL && !process.env.DATA_DIR && (!databaseUrl() || !blobConfigured());
}

/**
 * Where local data lives (when no hosted database or Blob store is set). On your machine: ./.data. On Vercel only /tmp is
 * writable, so data there is temporary and per server instance.
 */
export function dataDir(): string {
  if (process.env.DATA_DIR) return path.resolve(process.env.DATA_DIR);
  return process.env.VERCEL ? "/tmp/rample-data" : path.join(process.cwd(), ".data");
}

/** Server secret for signing cookies and file links. Never throws. */
export function serverSecret(): string {
  const base = process.env.SESSION_SECRET || process.env.CRON_SECRET || process.env.ANTHROPIC_API_KEY || "rample-local-secret-v1";
  return createHmac("sha256", base).update("rample").digest("hex");
}
