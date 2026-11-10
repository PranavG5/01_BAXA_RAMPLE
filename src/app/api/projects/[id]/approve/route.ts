import { after, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/server/auth";
import { api, readJson } from "@/lib/server/http";
import { approveVersion, loadProject } from "@/lib/server/pipeline/projects";
import { advanceProject, startRendering } from "@/lib/server/pipeline/render";

export const maxDuration = 300;

/** FR-18/FR-19: one button. Rendering and credit spend start only here. */
export const POST = api(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { business, user } = await requireApiUser();
  const { id } = await params;
  const { versionId } = await readJson<{ versionId?: string }>(req);
  const project = await loadProject(business, id);
  const version = await approveVersion(business, project, String(versionId ?? ""), user.id);
  await startRendering(project, version.id, user.id);
  after(() => advanceProject(project.id).then(() => undefined).catch((e) => console.error("[advance]", e)));
  return NextResponse.json({ version });
});
