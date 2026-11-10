import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/server/auth";
import { api, readJson } from "@/lib/server/http";
import { createProject } from "@/lib/server/pipeline/projects";

export const maxDuration = 120;

/** Manual Mode trigger: the owner starts a "Full video" request (PRD 3.2). */
export const POST = api(async (req: Request) => {
  const { business } = await requireApiUser();
  const { prompt } = await readJson<{ prompt?: string }>(req);
  const project = await createProject(business, String(prompt ?? ""));
  return NextResponse.json({ project });
});
