import "server-only";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { authClient, db, must } from "./supabase";
import { env } from "./env";
import { HttpError } from "./http";
import type { BusinessProfile } from "../types";

export async function currentUser(): Promise<User | null> {
  try {
    const supabase = await authClient();
    const { data } = await supabase.auth.getUser();
    return data.user ?? null;
  } catch {
    return null;
  }
}

export function isStaff(user: Pick<User, "email"> | null): boolean {
  const email = user?.email?.toLowerCase();
  return !!email && env.staffEmails().includes(email);
}

export async function businessFor(userId: string): Promise<BusinessProfile> {
  const existing = must(
    await db().from("business_profiles").select("*").eq("owner_id", userId).maybeSingle(),
    "load business profile",
  );
  if (existing) return existing as BusinessProfile;
  const created = must(
    await db()
      .from("business_profiles")
      .insert({ owner_id: userId, credit_cap_default: env.defaultCreditCap() })
      .select("*")
      .single(),
    "create business profile",
  );
  return created as BusinessProfile;
}

/** For pages: redirect to /login when signed out. */
export async function requirePageUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const business = await businessFor(user.id);
  return { user, business, staff: isStaff(user) };
}

export async function requirePageStaff() {
  const ctx = await requirePageUser();
  if (!ctx.staff) redirect("/studio");
  return ctx;
}

/** For API routes: 401 when signed out. */
export async function requireApiUser() {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Sign in required.");
  const business = await businessFor(user.id);
  return { user, business, staff: isStaff(user) };
}

export async function requireApiStaff() {
  const ctx = await requireApiUser();
  if (!ctx.staff) throw new HttpError(403, "Rample staff only.");
  return ctx;
}
