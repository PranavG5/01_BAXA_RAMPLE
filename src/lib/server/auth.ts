import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db, must } from "./supabase";
import { env } from "./env";
import { HttpError } from "./http";
import type { BusinessProfile } from "../types";

/**
 * Single hardcoded admin account. This account owns the business and also
 * has the Rample staff pages (review queue, registry, metrics).
 */
export const ADMIN = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "test@rample.ai",
  password: "baxatest",
} as const;

export interface AppUser {
  id: string;
  email: string;
}

export const SESSION_COOKIE = "rample_session";
const SESSION_DAYS = 30;

function sessionKey(): string {
  // Prefer a dedicated secret; fall back to one derived from the service key so it is never empty.
  return process.env.SESSION_SECRET || createHmac("sha256", env.supabaseServiceKey()).update("rample-session").digest("hex");
}

function sign(payload: string): string {
  return createHmac("sha256", sessionKey()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function checkCredentials(email: string, password: string): boolean {
  return safeEqual(email.trim().toLowerCase(), ADMIN.email) && safeEqual(password, ADMIN.password);
}

export function createSessionValue(): { value: string; maxAge: number } {
  const maxAge = SESSION_DAYS * 86_400;
  const payload = `${ADMIN.id}.${Math.floor(Date.now() / 1000) + maxAge}`;
  return { value: `${payload}.${sign(payload)}`, maxAge };
}

export async function currentUser(): Promise<AppUser | null> {
  try {
    const raw = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!raw) return null;
    const [id, exp, sig] = raw.split(".");
    if (!id || !exp || !sig || !safeEqual(sig, sign(`${id}.${exp}`))) return null;
    if (Number(exp) < Date.now() / 1000 || id !== ADMIN.id) return null;
    return { id: ADMIN.id, email: ADMIN.email };
  } catch {
    return null;
  }
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
      .upsert({ owner_id: userId, credit_cap_default: env.defaultCreditCap() }, { onConflict: "owner_id" })
      .select("*")
      .single(),
    "create business profile",
  );
  return created as BusinessProfile;
}

/** For pages: redirect to /login when signed out. The admin is always staff. */
export async function requirePageUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const business = await businessFor(user.id);
  return { user, business, staff: true };
}

export async function requirePageStaff() {
  return requirePageUser();
}

/** For API routes: 401 when signed out. */
export async function requireApiUser() {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Sign in required.");
  const business = await businessFor(user.id);
  return { user, business, staff: true };
}

export async function requireApiStaff() {
  return requireApiUser();
}
