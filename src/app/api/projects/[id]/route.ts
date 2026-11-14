import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/server/auth";
import { api } from "@/lib/server/http";
import { deleteProject } from "@/lib/server/pipeline/delete";

/** Deletes a video project in any state, with its storyboards, clips, videos and files. */
export const DELETE = api(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { business } = await requireApiUser();
  const { id } = await params;
  await deleteProject(business, id);
  return NextResponse.json({ ok: true });
});
