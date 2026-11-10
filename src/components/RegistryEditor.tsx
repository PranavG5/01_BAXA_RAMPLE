"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RegistryModel } from "@/lib/core/routing-rules";
import { MOTION_TAGS, SHOT_TYPES, labelFor } from "@/lib/core/vocabulary";
import { call } from "@/lib/client";
import { Badge, Card, btn, cx } from "./ui";

type Row = RegistryModel & { stale: boolean };
const input = "mt-1 w-full rounded-md border border-line px-2 py-1.5 text-sm outline-none focus:border-brand";

const BLANK: RegistryModel = {
  model_id: "pika:",
  provider: "pika",
  endpoint: "",
  display_name: "",
  status: "usable_with_caveats",
  status_reason: "",
  enabled: true,
  pros: "",
  cons: "",
  best_for: [],
  avoid_for: [],
  start_image_support: true,
  min_duration_s: 3,
  max_duration_s: 10,
  allowed_durations: null,
  aspect_ratios: ["follows_input"],
  resolution: "720p",
  cost_credits_per_second: 5,
  latency_s: 120,
  prompt_guidelines: "",
  request_config: { image_field: "image_url", prompt_field: "prompt", duration_field: "duration", static: {} },
  evidence_links: [],
  evaluated_on: null,
  evaluator: "",
  registry_version: 0,
};

export function RegistryEditor({ models, pins, windowDays }: { models: Row[]; pins: Record<string, string>; windowDays: number }) {
  const router = useRouter();
  const [editing, setEditing] = useState<RegistryModel | null>(null);
  const [days, setDays] = useState(String(windowDays));

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <button className={cx(btn.base, btn.primary)} onClick={() => setEditing({ ...BLANK })}>Add model</button>
        <label className="text-sm">
          Re-evaluation window (days)
          <span className="flex gap-2">
            <input className={cx(input, "w-24")} value={days} onChange={(e) => setDays(e.target.value)} />
            <button className={cx(btn.base, btn.secondary, "mt-1 py-1")} onClick={() => act(() => call("/api/registry/meta", { method: "PUT", json: { reeval_window_days: Number(days) } }))}>Save</button>
          </span>
        </label>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3">Model</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Best for / avoid</th>
              <th className="px-4 py-3">Limits</th>
              <th className="px-4 py-3">Cost</th>
              <th className="px-4 py-3">Evaluated</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.model_id} className={cx("border-b border-line last:border-0 align-top", !m.enabled && "opacity-50")}>
                <td className="px-4 py-3">
                  <p className="font-semibold">{m.display_name}</p>
                  <p className="text-xs text-muted">{m.model_id}</p>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={m.status === "usable" ? "good" : m.status === "not_usable" ? "bad" : "warn"}>{labelFor(m.status)}</Badge>
                  {!m.start_image_support && <Badge tone="bad" className="mt-1">No start image</Badge>}
                </td>
                <td className="px-4 py-3 text-xs">
                  <div className="flex flex-wrap gap-1">{m.best_for.map((t) => <Badge key={t} tone="good">{labelFor(t)}</Badge>)}</div>
                  <div className="mt-1 flex flex-wrap gap-1">{m.avoid_for.map((t) => <Badge key={t} tone="bad">{labelFor(t)}</Badge>)}</div>
                </td>
                <td className="px-4 py-3 text-xs text-muted">
                  {m.allowed_durations ? `${m.allowed_durations.join("/")}s` : `${m.min_duration_s}-${m.max_duration_s}s`} · {m.aspect_ratios.join(", ")} · {m.resolution}
                </td>
                <td className="px-4 py-3 text-xs">{m.cost_credits_per_second} cr/s</td>
                <td className="px-4 py-3 text-xs">
                  {m.evaluated_on ?? "Never"}
                  {m.stale && <Badge tone="warn" className="mt-1">Re-evaluate</Badge>}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button className="text-sm text-brand underline" onClick={() => setEditing(m)}>Edit</button>
                  <button className="ml-3 text-sm text-muted underline" onClick={() => act(() => call("/api/registry", { method: "PATCH", json: { model_id: m.model_id, enabled: !m.enabled } }))}>
                    {m.enabled ? "Disable" : "Enable"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Card>
        <h2 className="font-semibold">Pins</h2>
        <p className="mt-1 text-sm text-muted">Pin a model to a shot type to bypass Claude for that scene type. Takes effect on the next storyboard version.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {SHOT_TYPES.map((t) => (
            <label key={t} className="text-sm font-medium">
              {labelFor(t)}
              <select className={input} value={pins[t] ?? ""} onChange={(e) => act(() => call("/api/registry/pins", { method: "POST", json: { shot_type: t, model_id: e.target.value || null } }))}>
                <option value="">Let Claude choose</option>
                {models.filter((m) => m.enabled && m.status !== "not_usable").map((m) => <option key={m.model_id} value={m.model_id}>{m.display_name}</option>)}
              </select>
            </label>
          ))}
        </div>
      </Card>

      {editing && <ModelForm model={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); router.refresh(); }} />}
    </div>
  );
}

function ModelForm({ model, onClose, onSaved }: { model: RegistryModel; onClose: () => void; onSaved: () => void }) {
  const [m, setM] = useState<RegistryModel>(model);
  const [config, setConfig] = useState(JSON.stringify(model.request_config, null, 2));
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof RegistryModel>(k: K, v: RegistryModel[K]) => setM({ ...m, [k]: v });
  const toggleTag = (k: "best_for" | "avoid_for", t: string) => set(k, m[k].includes(t) ? m[k].filter((x) => x !== t) : [...m[k], t]);

  async function save() {
    setError(null);
    try {
      const request_config = JSON.parse(config);
      await call("/api/registry", { method: "PUT", json: { model: { ...m, request_config } } });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="h-full w-full max-w-xl overflow-y-auto bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">{model.registry_version ? "Edit model" : "Add model"}</h2>
        <p className="text-xs text-muted">Fill this from the UI/UX evaluation template (Appendix A).</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm sm:col-span-2">Model ID<input className={input} value={m.model_id} onChange={(e) => set("model_id", e.target.value)} disabled={!!model.registry_version} /></label>
          <label className="text-sm">Provider
            <select className={input} value={m.provider} onChange={(e) => set("provider", e.target.value as RegistryModel["provider"])}>
              <option value="pika">Pika</option>
              <option value="higgsfield">Higgsfield</option>
            </select>
          </label>
          <label className="text-sm">Endpoint<input className={input} value={m.endpoint} onChange={(e) => set("endpoint", e.target.value)} placeholder="vendor/model/image-to-video" /></label>
          <label className="text-sm sm:col-span-2">Display name<input className={input} value={m.display_name} onChange={(e) => set("display_name", e.target.value)} /></label>
          <label className="text-sm">Status
            <select className={input} value={m.status} onChange={(e) => set("status", e.target.value as RegistryModel["status"])}>
              <option value="usable">Usable</option>
              <option value="usable_with_caveats">Usable with caveats</option>
              <option value="not_usable">Not usable</option>
            </select>
          </label>
          <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={m.start_image_support} onChange={(e) => set("start_image_support", e.target.checked)} /> Accepts a start image</label>
          <label className="text-sm sm:col-span-2">Status reason<input className={input} value={m.status_reason} onChange={(e) => set("status_reason", e.target.value)} /></label>
          <label className="text-sm sm:col-span-2">Pros<textarea className={input} value={m.pros} onChange={(e) => set("pros", e.target.value)} /></label>
          <label className="text-sm sm:col-span-2">Cons<textarea className={input} value={m.cons} onChange={(e) => set("cons", e.target.value)} /></label>
          {(["best_for", "avoid_for"] as const).map((k) => (
            <div key={k} className="text-sm sm:col-span-2">
              {labelFor(k)}
              <div className="mt-1 flex flex-wrap gap-1">
                {MOTION_TAGS.map((t) => (
                  <button key={t} type="button" onClick={() => toggleTag(k, t)} className={cx("rounded-full border px-2 py-0.5 text-xs", m[k].includes(t) ? (k === "best_for" ? "border-good bg-good/10 text-good" : "border-bad bg-bad/10 text-bad") : "border-line text-muted")}>
                    {labelFor(t)}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <label className="text-sm">Min seconds<input type="number" className={input} value={m.min_duration_s} onChange={(e) => set("min_duration_s", Number(e.target.value))} /></label>
          <label className="text-sm">Max seconds<input type="number" className={input} value={m.max_duration_s} onChange={(e) => set("max_duration_s", Number(e.target.value))} /></label>
          <label className="text-sm">Allowed durations (comma list, empty = any)<input className={input} value={m.allowed_durations?.join(",") ?? ""} onChange={(e) => set("allowed_durations", e.target.value.trim() ? e.target.value.split(",").map((x) => Number(x.trim())).filter(Boolean) : null)} /></label>
          <label className="text-sm">Aspect ratios<input className={input} value={m.aspect_ratios.join(",")} onChange={(e) => set("aspect_ratios", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} placeholder="9:16 or follows_input" /></label>
          <label className="text-sm">Resolution<input className={input} value={m.resolution} onChange={(e) => set("resolution", e.target.value)} /></label>
          <label className="text-sm">Credits per second<input type="number" step="0.1" className={input} value={m.cost_credits_per_second} onChange={(e) => set("cost_credits_per_second", Number(e.target.value))} /></label>
          <label className="text-sm">Typical latency (s)<input type="number" className={input} value={m.latency_s} onChange={(e) => set("latency_s", Number(e.target.value))} /></label>
          <label className="text-sm">Evaluated on<input type="date" className={input} value={m.evaluated_on ?? ""} onChange={(e) => set("evaluated_on", e.target.value || null)} /></label>
          <label className="text-sm sm:col-span-2">Evaluator<input className={input} value={m.evaluator} onChange={(e) => set("evaluator", e.target.value)} /></label>
          <label className="text-sm sm:col-span-2">Prompt guidelines<textarea className={input} value={m.prompt_guidelines} onChange={(e) => set("prompt_guidelines", e.target.value)} /></label>
          <label className="text-sm sm:col-span-2">Evidence links (one per line)<textarea className={input} value={m.evidence_links.join("\n")} onChange={(e) => set("evidence_links", e.target.value.split("\n").map((x) => x.trim()).filter(Boolean))} /></label>
          <label className="text-sm sm:col-span-2">Request mapping (JSON)<textarea className={cx(input, "min-h-32 font-mono text-xs")} value={config} onChange={(e) => setConfig(e.target.value)} /></label>
        </div>
        {error && <p className="mt-3 text-sm text-bad">{error}</p>}
        <div className="mt-5 flex gap-2">
          <button className={cx(btn.base, btn.primary)} onClick={save}>Save</button>
          <button className={cx(btn.base, btn.ghost)} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
