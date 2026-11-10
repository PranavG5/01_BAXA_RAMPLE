import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/server/auth";
import { api } from "@/lib/server/http";
import { generateStoryboard, loadProject } from "@/lib/server/pipeline/projects";

export const maxDuration = 300;

/** FR-6: Claude drafts the storyboard; the router picks a model per animated scene. No rendering. */
export const POST = api(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { business } = await requireApiUser();
  const { id } = await params;
  const version = await generateStoryboard(business, await loadProject(business, id));
  return NextResponse.json({ version });
});
