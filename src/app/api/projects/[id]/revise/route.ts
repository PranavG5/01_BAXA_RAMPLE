import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/server/auth";
import { api, badRequest, readJson } from "@/lib/server/http";
import { loadProject, reviseByChat, reviseInline } from "@/lib/server/pipeline/projects";
import { SceneDraftSchema } from "@/lib/core/schemas";

export const maxDuration = 300;

/** FR-8: every edit (chat or inline) creates a new version; only changed scenes are re-routed. */
export const POST = api(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { business } = await requireApiUser();
  const { id } = await params;
  const project = await loadProject(business, id);
  const body = await readJson<{ message?: string; scenes?: unknown[]; note?: string }>(req);
  if (Array.isArray(body.scenes)) {
    const parsed = body.scenes.map((s) => SceneDraftSchema.safeParse(s));
    const bad = parsed.findIndex((p) => !p.success);
    if (bad >= 0) throw badRequest(`Scene ${bad + 1} has invalid fields.`);
    const version = await reviseInline(business, project, parsed.map((p) => p.data!), String(body.note ?? ""));
    return NextResponse.json({ version });
  }
  const version = await reviseByChat(business, project, String(body.message ?? ""));
  return NextResponse.json({ version });
});
