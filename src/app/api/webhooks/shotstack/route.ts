import { after, NextResponse } from "next/server";
import { advanceProject, nudgeByAssembly } from "@/lib/server/pipeline/render";

export const maxDuration = 300;

/** Shotstack render callback. A nudge only; status is re-read from Shotstack. */
export async function POST(req: Request) {
  let renderId: string | undefined;
  try {
    renderId = ((await req.json()) as { id?: string }).id;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const projectId = renderId ? await nudgeByAssembly(renderId) : null;
  if (projectId) after(() => advanceProject(projectId).then(() => undefined).catch((e) => console.error("[webhook]", e)));
  return NextResponse.json({ ok: true });
}
