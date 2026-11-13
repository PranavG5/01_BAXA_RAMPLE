import "server-only";
import { createHmac } from "node:crypto";
import path from "node:path";

/** Hosted Postgres connection string (Supabase: the Transaction pooler string). */
export function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim() || undefined;
}

/**
 * Supabase Storage settings: the project URL and a server-only secret key
 * (sb_secret_... or the legacy service_role key). Never the publishable key.
 */
export function supabaseStorageConfig(): { url: string; key: string } | null {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.trim();
  const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  return url && key ? { url, key } : null;
}

/**
 * True when uploads and the database only live in this server instance's /tmp,
 * so other instances (and later requests) cannot see them.
 */
export function storageIsTemporary(): boolean {
  return !!process.env.VERCEL && !process.env.DATA_DIR && (!databaseUrl() || !supabaseStorageConfig());
}

/**
 * Where local data lives (when no hosted database or Supabase Storage is set). On your machine: ./.data. On Vercel only /tmp is
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
