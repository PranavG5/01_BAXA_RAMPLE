import { NextResponse } from "next/server";
import { requireApiStaff } from "@/lib/server/auth";
import { api, badRequest, readJson } from "@/lib/server/http";
import { gradeDecision } from "@/lib/server/pipeline/review";

export const POST = api(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { user } = await requireApiStaff();
  const { id } = await params;
  const { grade, note } = await readJson<{ grade?: string; note?: string }>(req);
  if (grade !== "agree" && grade !== "disagree") throw badRequest("Grade must be agree or disagree.");
  await gradeDecision(id, grade, user.email ?? user.id, String(note ?? ""));
  return NextResponse.json({ ok: true });
});
