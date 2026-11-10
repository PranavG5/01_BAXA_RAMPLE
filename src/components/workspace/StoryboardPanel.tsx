"use client";

import { useState } from "react";
import type { SceneDraft } from "@/lib/core/schemas";
import { SHOT_TYPES, STILL_EFFECTS, labelFor } from "@/lib/core/vocabulary";
import { USD_PER_CREDIT } from "@/lib/core/vocabulary";
import { call } from "@/lib/client";
import { Badge, Card, Notice, btn, cx } from "../ui";
import { PreviewPlayer } from "./PreviewPlayer";
import { EFFECT_ANIMATION, TREATMENT_LABEL, type Brand, type LibraryPhoto, type ProjectSnapshot, type SceneView } from "./types";

const field = "w-full rounded-md border border-line px-2 py-1.5 text-xs outline-none focus:border-brand";

function toDraft(s: SceneView): SceneDraft {
  return {
    order: s.scene_order,
    role: s.role,
    duration_s: Number(s.duration_s),
    background_asset_id: s.background_asset_id ?? "",
    treatment: s.treatment,
    shot_type: s.shot_type as SceneDraft["shot_type"],
    motion_prompt: s.motion_prompt,
    subject_description: s.subject_description,
    still_motion_effect: (s.still_motion_effect as SceneDraft["still_motion_effect"]) ?? null,
    voiceover: s.voiceover,
    on_screen_text: s.on_screen_text,
  };
}

export function StoryboardPanel({
  snap,
  library,
  brand,
  viewingOld,
  onSelectVersion,
  onChange,
}: {
  snap: ProjectSnapshot;
  library: LibraryPhoto[];
  brand: Brand;
  viewingOld: boolean;
  onSelectVersion: (id: string) => void;
  onChange: () => void;
}) {
  const version = snap.version!;
  const editableState = ["draft", "revised"].includes(version.state) && !viewingOld;
  const canRevise = !viewingOld && !["rendering", "qa", "approved"].includes(version.state);
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<SceneDraft[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [picker, setPicker] = useState<number | null>(null);
  const photos = new Map(library.map((p) => [p.id, p]));

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      onChange();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      return false;
    } finally {
      setBusy(null);
    }
  }

  const runtime = Number(version.total_runtime_s);
  const est = Number(version.est_credits);
  const animated = snap.scenes.filter((s) => s.treatment === "animate").length;

  function startEdit() {
    setDrafts(snap.scenes.map(toDraft));
    setEditing(true);
  }
  const patch = (i: number, p: Partial<SceneDraft>) => setDrafts(drafts.map((d, j) => (j === i ? { ...d, ...p } : d)));
  const move = (i: number, dir: -1 | 1) => {
    const next = [...drafts];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setDrafts(next.map((d, k) => ({ ...d, order: k + 1 })));
  };

  async function approve() {
    const usd = (est * USD_PER_CREDIT).toFixed(2);
    const ok = confirm(
      `Approve version ${version.version} and start rendering?\n\n${animated} AI-animated scene(s), about ${est} credits ($${usd}).\nCredit cap for this video: ${snap.credits.cap} credits.\n\nNothing has been spent yet. Credits are only spent after you approve.`,
    );
    if (!ok) return;
    await run("approve", () => call(`/api/projects/${snap.project.id}/approve`, { method: "POST", json: { versionId: version.id } }));
  }

  return (
    <Card className="p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">Storyboard</h2>
            <select value={version.id} onChange={(e) => onSelectVersion(e.target.value)} className="rounded-md border border-line px-2 py-1 text-xs">
              {snap.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version} · {v.state}
                  {v.id === snap.project.current_version_id ? " (latest)" : ""}
                </option>
              ))}
            </select>
            {version.change_note && <span className="text-xs text-muted">“{version.change_note}”</span>}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <span><b>{runtime}s</b> <span className="text-muted">total</span></span>
            <span><b>{snap.scenes.length}</b> <span className="text-muted">scenes</span></span>
            <span><b>{est}</b> <span className="text-muted">est. credits (${(est * USD_PER_CREDIT).toFixed(2)})</span></span>
            <span className="text-muted">cap {snap.credits.cap}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setPreview(true)} className={cx(btn.base, btn.secondary)}>▶ Free preview</button>
          {canRevise && !editing && <button onClick={startEdit} className={cx(btn.base, btn.secondary)}>Edit scenes</button>}
          {editableState && !editing && (
            <button disabled={!!busy || snap.blockers.length > 0} onClick={approve} className={cx(btn.base, btn.primary)}>
              {busy === "approve" ? "Starting…" : "Approve and render"}
            </button>
          )}
        </div>
      </div>

      {viewingOld && <div className="mt-4"><Notice tone="brand">You are viewing an older version. Switch back to the latest to make changes.</Notice></div>}
      {version.validation_warnings.length > 0 && !editing && (
        <div className="mt-4">
          <Notice>
            {version.validation_warnings.map((w) => (
              <span key={w} className="block">{w}</span>
            ))}
          </Notice>
        </div>
      )}
      {editableState && snap.blockers.length > 0 && !editing && (
        <div className="mt-4">
          <Notice tone="bad">
            {snap.blockers.map((b) => (
              <span key={b} className="block">{b}</span>
            ))}
          </Notice>
        </div>
      )}
      {error && <p className="mt-4 text-sm text-bad">{error}</p>}

      {!editing ? (
        <div className="-mx-6 mt-5 flex snap-x gap-4 overflow-x-auto px-6 pb-2">
          {snap.scenes.map((s) => (
            <SceneCard key={s.id} s={s} brand={brand} canFix={editableState} onFix={() => run("fix", () => call(`/api/projects/${snap.project.id}/revise`, { method: "POST", json: { scenes: snap.scenes.map((x) => (x.id === s.id ? { ...toDraft(x), treatment: "still_motion", motion_prompt: "", still_motion_effect: "zoomInSlow" } : toDraft(x))), note: `Scene ${s.scene_order} switched to photo motion` } }))} />
          ))}
        </div>
      ) : (
        <div className="mt-5">
          <div className="-mx-6 flex snap-x gap-4 overflow-x-auto px-6 pb-2">
            {drafts.map((d, i) => {
              const photo = photos.get(d.background_asset_id);
              return (
                <div key={i} className="w-64 shrink-0 snap-start space-y-2 rounded-xl border border-line bg-white p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">Scene {i + 1} · {labelFor(d.role)}</span>
                    <span className="flex gap-1">
                      <button className="rounded px-1 text-muted hover:bg-canvas" onClick={() => move(i, -1)} aria-label="Move left">←</button>
                      <button className="rounded px-1 text-muted hover:bg-canvas" onClick={() => move(i, 1)} aria-label="Move right">→</button>
                      <button className="rounded px-1 text-bad hover:bg-bad/5" onClick={() => setDrafts(drafts.filter((_, j) => j !== i).map((x, k) => ({ ...x, order: k + 1 })))} aria-label="Remove scene">×</button>
                    </span>
                  </div>
                  <button onClick={() => setPicker(i)} className="relative block aspect-[9/16] w-full overflow-hidden rounded-lg bg-canvas">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {photo?.thumb_url && <img src={photo.thumb_url} alt="" className="h-full w-full object-cover" />}
                    <span className="absolute inset-x-2 bottom-2 rounded bg-black/60 py-1 text-white">Change photo</span>
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                    <label>Seconds<input type="number" step={0.5} min={1} max={8} className={field} value={d.duration_s} onChange={(e) => patch(i, { duration_s: Number(e.target.value) })} /></label>
                    <label>Treatment
                      <select className={field} value={d.treatment} onChange={(e) => patch(i, { treatment: e.target.value as SceneDraft["treatment"], still_motion_effect: e.target.value === "animate" ? null : (d.still_motion_effect ?? "zoomInSlow") })}>
                        <option value="animate">AI-animated</option>
                        <option value="still_motion">Photo motion</option>
                        <option value="end_card">End card</option>
                      </select>
                    </label>
                    <label>Shot
                      <select className={field} value={d.shot_type} onChange={(e) => patch(i, { shot_type: e.target.value as SceneDraft["shot_type"] })}>
                        {SHOT_TYPES.map((t) => <option key={t} value={t}>{labelFor(t)}</option>)}
                      </select>
                    </label>
                    {d.treatment !== "animate" ? (
                      <label>Motion
                        <select className={field} value={d.still_motion_effect ?? "zoomInSlow"} onChange={(e) => patch(i, { still_motion_effect: e.target.value as SceneDraft["still_motion_effect"] })}>
                          {STILL_EFFECTS.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </label>
                    ) : <span />}
                  </div>
                  {d.treatment === "animate" && (
                    <label className="block">What moves<textarea className={cx(field, "min-h-16")} value={d.motion_prompt} onChange={(e) => patch(i, { motion_prompt: e.target.value })} /></label>
                  )}
                  <label className="block">On-screen text<input className={field} value={d.on_screen_text} onChange={(e) => patch(i, { on_screen_text: e.target.value })} /></label>
                  <label className="block">Voiceover<textarea className={cx(field, "min-h-12")} value={d.voiceover} onChange={(e) => patch(i, { voiceover: e.target.value })} /></label>
                </div>
              );
            })}
            {drafts.length < 5 && (
              <button
                onClick={() => {
                  const last = drafts[drafts.length - 1];
                  const insertAt = last?.treatment === "end_card" ? drafts.length - 1 : drafts.length;
                  const next = [...drafts];
                  next.splice(insertAt, 0, { ...(drafts[1] ?? drafts[0]), role: "showcase", treatment: "still_motion", motion_prompt: "", still_motion_effect: "zoomInSlow", on_screen_text: "", voiceover: "", duration_s: 3, order: 0 });
                  setDrafts(next.map((x, k) => ({ ...x, order: k + 1 })));
                }}
                className="flex w-40 shrink-0 items-center justify-center rounded-xl border-2 border-dashed border-line text-sm text-muted hover:border-brand hover:text-brand"
              >
                + Add scene
              </button>
            )}
          </div>
          <div className="mt-4 flex gap-2">
            <button disabled={!!busy} onClick={async () => (await run("inline", () => call(`/api/projects/${snap.project.id}/revise`, { method: "POST", json: { scenes: drafts, note: "Edited directly" } }))) && setEditing(false)} className={cx(btn.base, btn.primary)}>
              {busy === "inline" ? "Saving new version…" : "Save as new version"}
            </button>
            <button disabled={!!busy} onClick={() => setEditing(false)} className={cx(btn.base, btn.ghost)}>Cancel</button>
          </div>
        </div>
      )}

      {canRevise && !editing && (
        <form
          className="mt-5 flex flex-col gap-2 sm:flex-row"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run("chat", () => call(`/api/projects/${snap.project.id}/revise`, { method: "POST", json: { message } }))) setMessage("");
          }}
        >
          <input value={message} onChange={(e) => setMessage(e.target.value)} disabled={!!busy} placeholder="Ask for changes: “Make the hook about the hot towel”, “Use the storefront photo at the end”…" className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand" />
          <button disabled={!!busy || !message.trim()} className={cx(btn.base, btn.secondary)}>{busy === "chat" ? "Revising…" : "Revise"}</button>
        </form>
      )}
      {version.state === "failed" && !viewingOld && (
        <p className="mt-3 text-xs text-muted">This version could not be finished. Edit the scenes or ask for changes to create a new version.</p>
      )}

      {picker !== null && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" onClick={() => setPicker(null)}>
          <div className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <p className="mb-3 font-semibold">Choose a photo for scene {picker + 1}</p>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {library.map((p) => (
                <button key={p.id} onClick={() => { patch(picker, { background_asset_id: p.id }); setPicker(null); }} className={cx("overflow-hidden rounded-lg border text-left", drafts[picker]?.background_asset_id === p.id ? "border-brand ring-2 ring-brand" : "border-line")}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {p.thumb_url && <img src={p.thumb_url} alt={p.subject} className="aspect-[9/16] w-full object-cover" />}
                  <span className="block truncate p-1 text-[11px] text-muted">{labelFor(p.area)}{!p.usable && " · low quality"}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {preview && <PreviewPlayer scenes={snap.scenes} brand={brand} onClose={() => setPreview(false)} />}
    </Card>
  );
}

function SceneCard({ s, brand, canFix, onFix }: { s: SceneView; brand: Brand; canFix: boolean; onFix: () => void }) {
  const [details, setDetails] = useState(false);
  const anim = s.treatment === "animate" ? "kb-zoom-in" : (EFFECT_ANIMATION[s.still_motion_effect ?? ""] ?? "kb-zoom-in");
  return (
    <div className="w-56 shrink-0 snap-start" style={{ animation: "fade-in 300ms ease both" }}>
      <div className="relative aspect-[9/16] overflow-hidden rounded-xl bg-black">
        {s.photo_thumb_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={s.photo_thumb_url}
            alt=""
            className={cx("h-full w-full object-cover", s.treatment === "end_card" && "brightness-50")}
            style={{ animation: `${anim} ${Math.max(2, Number(s.duration_s))}s ease-in-out infinite alternate` }}
          />
        )}
        {!s.photo_thumb_url && <div className="flex h-full items-center justify-center p-4 text-center text-xs text-white/70">Background photo missing</div>}
        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          <Badge tone={s.treatment === "animate" ? "brand" : "neutral"} className="bg-white/90">{TREATMENT_LABEL[s.treatment]}</Badge>
        </div>
        <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">{Number(s.duration_s)}s</span>
        {s.on_screen_text && (
          <div className={cx("absolute inset-x-3 text-center text-sm font-extrabold leading-tight text-white", s.role === "hook" ? "top-[38%]" : s.treatment === "end_card" ? "top-[45%]" : "top-[12%]")}>
            <span className="rounded-md px-2 py-1 [box-decoration-break:clone]" style={{ background: s.role === "hook" || s.treatment === "end_card" ? brand.primary : "rgba(0,0,0,0.35)" }}>
              {s.on_screen_text}
            </span>
          </div>
        )}
        {s.treatment === "end_card" && brand.booking && (
          <div className="absolute inset-x-3 top-[62%] text-center text-[11px] font-bold">
            <span className="rounded px-2 py-1 text-black" style={{ background: brand.accent }}>{brand.booking.replace(/^https?:\/\//, "")}</span>
          </div>
        )}
      </div>
      <div className="mt-2 space-y-1 text-xs">
        <p className="font-semibold">Scene {s.scene_order} · {labelFor(s.role)} · {labelFor(s.shot_type)}</p>
        {s.voiceover && <p className="text-muted">🎙 “{s.voiceover}”</p>}
        {s.treatment === "animate" && s.motion_prompt && <p className="text-muted">Motion: {s.motion_prompt}</p>}
        {s.treatment === "animate" && (
          <p className="text-muted">
            {s.model_id ? `~${Number(s.est_credits)} credits` : <span className="font-medium text-bad">No model fits this scene</span>}
            {s.route_flag && s.model_id && <span className="ml-1 text-warn">· flagged for ops</span>}
            {" · "}
            <button className="underline" onClick={() => setDetails(!details)}>{details ? "hide" : "why"}</button>
          </p>
        )}
        {details && s.decision && (
          <p className="rounded-md bg-canvas p-2 text-muted">
            {s.model_name && <b className="text-ink">{s.model_name}. </b>}
            {s.decision.reason} <span className="whitespace-nowrap">({s.decision.confidence} confidence{s.decision.source !== "claude" ? `, ${s.decision.source}` : ""})</span>
          </p>
        )}
        {canFix && s.treatment === "animate" && !s.model_id && (
          <button onClick={onFix} className="font-semibold text-brand underline">Switch to photo motion (free)</button>
        )}
      </div>
    </div>
  );
}
