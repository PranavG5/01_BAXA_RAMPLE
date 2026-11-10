import { NextResponse } from "next/server";
import { authClient } from "@/lib/server/supabase";

/** Email confirmation / magic link landing. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/studio";
  if (code) {
    const supabase = await authClient();
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL(next.startsWith("/") ? next : "/studio", url.origin));
}
