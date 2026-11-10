import { after, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/server/auth";
import { api } from "@/lib/server/http";
import { loadProject } from "@/lib/server/pipeline/projects";
import { advanceProject } from "@/lib/server/pipeline/render";
import { projectSnapshot } from "@/lib/server/pipeline/snapshot";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Live status for the workspace. While work is in flight, it also nudges the pipeline forward. */
export const GET = api(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { business } = await requireApiUser();
  const { id } = await params;
  const versionId = new URL(req.url).searchParams.get("version") ?? undefined;
  const project = await loadProject(business, id);
  if (["approved", "rendering", "qa", "needs_review"].includes(project.status)) {
    after(() => advanceProject(project.id).then(() => undefined).catch((e) => console.error("[advance]", e)));
  }
  return NextResponse.json(await projectSnapshot(business, project, { versionId }));
});
