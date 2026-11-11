import "server-only";
import { createHmac } from "node:crypto";
import path from "node:path";

/**
 * Where local data lives. On your machine: ./.data. On Vercel only /tmp is
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
