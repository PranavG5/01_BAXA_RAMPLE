import { after, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/server/auth";
import { api, readJson } from "@/lib/server/http";
import { loadProject, setCreditCap } from "@/lib/server/pipeline/projects";
import { advanceProject, syncProjectStatus } from "@/lib/server/pipeline/render";

export const maxDuration = 300;

export const PUT = api(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { business, user } = await requireApiUser();
  const { id } = await params;
  const { cap } = await readJson<{ cap?: number }>(req);
  const project = await loadProject(business, id);
  await setCreditCap(project, Number(cap), user.id);
  await syncProjectStatus(project.id);
  after(() => advanceProject(project.id).then(() => undefined).catch((e) => console.error("[advance]", e)));
  return NextResponse.json({ ok: true });
});
