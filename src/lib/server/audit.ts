import "server-only";
import { db } from "./db";

/** Append-only audit trail (NFR auditability). Never throws. */
export async function audit(projectId: string | null, actor: string, type: string, data: Record<string, unknown> = {}) {
  const { error } = await db().from("audit_events").insert({ project_id: projectId, actor, type, data });
  if (error) console.warn("[audit] failed", type, error.message);
}
