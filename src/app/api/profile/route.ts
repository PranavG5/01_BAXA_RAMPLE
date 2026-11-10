import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/server/auth";
import { api, badRequest, readJson } from "@/lib/server/http";
import { db, must } from "@/lib/server/supabase";

const HEX = /^#[0-9a-fA-F]{6}$/;

/** FR-4: business profile. */
export const PUT = api(async (req: Request) => {
  const { business } = await requireApiUser();
  const b = await readJson<Record<string, unknown>>(req);
  const str = (k: string, max = 500) => (typeof b[k] === "string" ? (b[k] as string).trim().slice(0, max) : undefined);
  const services = Array.isArray(b.services)
    ? (b.services as { name?: unknown; price?: unknown; notes?: unknown }[])
        .map((s) => ({ name: String(s.name ?? "").trim().slice(0, 80), price: String(s.price ?? "").trim().slice(0, 40), notes: String(s.notes ?? "").trim().slice(0, 200) }))
        .filter((s) => s.name)
        .slice(0, 40)
    : undefined;
  const colors = Array.isArray(b.brand_colors) ? (b.brand_colors as unknown[]).map(String).filter((c) => HEX.test(c)).slice(0, 4) : undefined;
  const type = b.business_type === "salon" || b.business_type === "barbershop" ? b.business_type : undefined;
  const cap = b.credit_cap_default !== undefined ? Number(b.credit_cap_default) : undefined;
  if (cap !== undefined && (!Number.isFinite(cap) || cap < 1 || cap > 100000)) throw badRequest("Credit cap must be between 1 and 100000.");
  const booking = str("booking_link", 300);
  if (booking && !/^https?:\/\//i.test(booking) && !/^[\w.-]+\.[a-z]{2,}/i.test(booking)) throw badRequest("Booking link should be a web address.");

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ["name", "tone", "address", "audience", "extra_facts"]) {
    const v = str(k, k === "extra_facts" ? 1500 : 300);
    if (v !== undefined) patch[k] = v;
  }
  if (booking !== undefined) patch.booking_link = booking;
  if (services) patch.services = services;
  if (colors) patch.brand_colors = colors;
  if (type) patch.business_type = type;
  if (cap !== undefined) patch.credit_cap_default = Math.round(cap);
  const profile = must(await db().from("business_profiles").update(patch).eq("id", business.id).select("*").single(), "save profile");
  return NextResponse.json({ profile });
});
