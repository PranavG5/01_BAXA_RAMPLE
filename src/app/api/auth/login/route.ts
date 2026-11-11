import { NextResponse } from "next/server";
import { checkCredentials, createSessionValue, SESSION_COOKIE } from "@/lib/server/auth";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  if (!checkCredentials(String(body.email ?? ""), String(body.password ?? ""))) {
    return NextResponse.json({ error: "Wrong email or password." }, { status: 401 });
  }
  const { value, maxAge } = createSessionValue();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });
  return res;
}
