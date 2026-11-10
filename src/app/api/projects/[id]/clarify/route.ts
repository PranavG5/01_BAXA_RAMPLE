import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/server/auth";
import { api, readJson } from "@/lib/server/http";
import { answerClarification, loadProject } from "@/lib/server/pipeline/projects";

export const maxDuration = 120;

export const POST = api(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { business } = await requireApiUser();
  const { id } = await params;
  const { answer } = await readJson<{ answer?: string }>(req);
  const project = await answerClarification(business, await loadProject(business, id), String(answer ?? ""));
  return NextResponse.json({ project });
});
