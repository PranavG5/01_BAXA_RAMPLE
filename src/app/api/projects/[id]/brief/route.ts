import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/server/auth";
import { api, conflict, readJson } from "@/lib/server/http";
import { loadProject, updateBrief } from "@/lib/server/pipeline/projects";

export const PUT = api(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { business } = await requireApiUser();
  const { id } = await params;
  const project = await loadProject(business, id);
  if (project.current_version_id) throw conflict("The storyboard already exists. Ask for changes in the storyboard chat instead.");
  const { brief } = await readJson<{ brief?: unknown }>(req);
  return NextResponse.json({ project: await updateBrief(business, project, brief) });
});
