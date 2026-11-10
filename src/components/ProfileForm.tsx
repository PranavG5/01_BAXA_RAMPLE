"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { BusinessProfile, Service } from "@/lib/types";
import { call } from "@/lib/client";
import { btn, Card, cx } from "./ui";

const input = "mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand";

export function ProfileForm({ profile, logoUrl }: { profile: BusinessProfile; logoUrl: string | null }) {
  const router = useRouter();
  const [p, setP] = useState(profile);
  const [services, setServices] = useState<Service[]>(profile.services.length ? profile.services : [{ name: "", price: "" }]);
  const [colors, setColors] = useState<string[]>(profile.brand_colors.length ? profile.brand_colors : ["#111111", "#F5C518"]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const set = (k: keyof BusinessProfile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setP({ ...p, [k]: e.target.value });

  async function save() {
    setBusy(true);
    setSaved(null);
    try {
      await call("/api/profile", {
        method: "PUT",
        json: { ...p, services: services.filter((s) => s.name.trim()), brand_colors: colors },
      });
      setSaved("Saved");
      router.refresh();
    } catch (e) {
      setSaved(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function uploadLogo(file: File | undefined) {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/profile/logo", { method: "POST", body: form });
    if (!res.ok) alert((await res.json()).error ?? "Logo upload failed");
    router.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <h2 className="font-semibold">Basics</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium sm:col-span-2">
            Business name
            <input className={input} value={p.name} onChange={set("name")} placeholder="Northside Barbers" />
          </label>
          <label className="text-sm font-medium">
            Type
            <select className={input} value={p.business_type} onChange={set("business_type")}>
              <option value="barbershop">Barbershop</option>
              <option value="salon">Salon</option>
            </select>
          </label>
          <label className="text-sm font-medium">
            Booking link
            <input className={input} value={p.booking_link} onChange={set("booking_link")} placeholder="book.northsidebarbers.com" />
          </label>
          <label className="text-sm font-medium sm:col-span-2">
            Address
            <input className={input} value={p.address} onChange={set("address")} />
          </label>
          <label className="text-sm font-medium sm:col-span-2">
            Tone
            <input className={input} value={p.tone} onChange={set("tone")} placeholder="Friendly, confident, no-nonsense" />
          </label>
          <label className="text-sm font-medium sm:col-span-2">
            Usual clients
            <input className={input} value={p.audience} onChange={set("audience")} placeholder="Local men 18-40, students, professionals" />
          </label>
          <label className="text-sm font-medium sm:col-span-2">
            Other facts Claude may use
            <textarea className={cx(input, "min-h-24")} value={p.extra_facts} onChange={set("extra_facts")} placeholder="Open Tue-Sat 9am-7pm. Walk-ins welcome. Free hot towel with every cut." />
          </label>
        </div>
      </Card>

      <div className="space-y-6">
        <Card>
          <h2 className="font-semibold">Services and prices</h2>
          <div className="mt-4 space-y-2">
            {services.map((s, i) => (
              <div key={i} className="grid grid-cols-[1fr_96px_32px] gap-2">
                <input className={input} value={s.name} placeholder="Skin fade" onChange={(e) => setServices(services.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <input className={input} value={s.price} placeholder="$30" onChange={(e) => setServices(services.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
                <button aria-label="Remove service" className="mt-1 text-muted hover:text-bad" onClick={() => setServices(services.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
          </div>
          <button className={cx(btn.base, btn.ghost, "mt-2 px-2")} onClick={() => setServices([...services, { name: "", price: "" }])}>+ Add service</button>
        </Card>

        <Card>
          <h2 className="font-semibold">Brand</h2>
          <div className="mt-4 flex flex-wrap items-center gap-6">
            {colors.map((c, i) => (
              <label key={i} className="flex items-center gap-2 text-sm font-medium">
                <input type="color" value={c} onChange={(e) => setColors(colors.map((x, j) => (j === i ? e.target.value : x)))} className="h-9 w-12 cursor-pointer rounded border border-line" />
                {i === 0 ? "Primary" : "Accent"}
              </label>
            ))}
          </div>
          <div className="mt-5 flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl border border-line bg-canvas">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {logoUrl ? <img src={logoUrl} alt="Logo" className="h-full w-full object-contain" /> : <span className="text-xs text-muted">Logo</span>}
            </div>
            <label className={cx(btn.base, btn.secondary, "cursor-pointer")}>
              Upload logo
              <input type="file" accept="image/*" className="hidden" onChange={(e) => uploadLogo(e.target.files?.[0])} />
            </label>
          </div>
        </Card>

        <Card>
          <h2 className="font-semibold">Spending</h2>
          <label className="mt-3 block text-sm font-medium">
            Credit cap per video (1 credit = $0.01)
            <input type="number" min={1} className={input} value={p.credit_cap_default} onChange={(e) => setP({ ...p, credit_cap_default: Number(e.target.value) })} />
          </label>
          <p className="mt-2 text-xs text-muted">Rendering stops if a video would spend more than this, including retries.</p>
        </Card>

        <div className="flex items-center gap-3">
          <button disabled={busy} onClick={save} className={cx(btn.base, btn.primary)}>{busy ? "Saving…" : "Save profile"}</button>
          {saved && <span className={cx("text-sm", saved === "Saved" ? "text-good" : "text-bad")}>{saved}</span>}
        </div>
      </div>
    </div>
  );
}
