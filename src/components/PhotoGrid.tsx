"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Asset } from "@/lib/types";
import { AREAS, labelFor } from "@/lib/core/vocabulary";
import { call } from "@/lib/client";
import { Badge, EmptyState, btn, cx } from "./ui";

type Photo = Asset & { thumb_url: string | null };

const FLAG_TEXT: Record<string, string> = {
  low_resolution: "Low resolution",
  bad_orientation: "Landscape: heavy crop",
  blurry: "Blurry",
  too_dark: "Too dark",
  overexposed: "Overexposed",
  cluttered: "Cluttered",
  watermark: "Watermark",
  screenshot: "Screenshot",
  heavy_filter: "Heavy filter",
  poor_for_animation: "Hard to animate",
};

export function PhotoGrid({ assets }: { assets: Photo[] }) {
  const router = useRouter();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<string | null>(null);

  if (!assets.length) {
    return <EmptyState title="No photos yet" body="Start with your storefront, the inside of the shop, a chair and mirror, your sign, your tools and a finished cut." />;
  }

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const stop = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  async function deleteSelected() {
    const ids = [...selected];
    if (!ids.length) return;
    if (!confirm(`Delete ${ids.length} photo${ids.length === 1 ? "" : "s"} for good?\n\nStoryboards that use them will need new photos. Finished videos are not affected.`)) return;
    const failed: string[] = [];
    for (const [i, id] of ids.entries()) {
      setProgress(`Deleting ${i + 1} of ${ids.length}…`);
      await call(`/api/assets/${id}`, { method: "DELETE" }).catch((e) => failed.push(e instanceof Error ? e.message : "failed"));
    }
    setProgress(null);
    stop();
    router.refresh();
    if (failed.length) alert(`${failed.length} photo(s) could not be deleted: ${failed[0]}`);
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">{assets.length} photo{assets.length === 1 ? "" : "s"}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {selecting ? (
            <>
              <button type="button" className={cx(btn.base, btn.ghost, "py-1.5")} onClick={() => setSelected(selected.size === assets.length ? new Set() : new Set(assets.map((a) => a.id)))}>
                {selected.size === assets.length ? "Select none" : "Select all"}
              </button>
              <button type="button" disabled={!selected.size || !!progress} className={cx(btn.base, btn.danger, "py-1.5")} onClick={deleteSelected}>
                {progress ?? (selected.size ? `Delete ${selected.size} selected` : "Delete selected")}
              </button>
              <button type="button" disabled={!!progress} className={cx(btn.base, btn.ghost, "py-1.5")} onClick={stop}>Cancel</button>
            </>
          ) : (
            <button type="button" className={cx(btn.base, btn.secondary, "py-1.5")} onClick={() => setSelecting(true)}>Select</button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
        {assets.map((a) =>
          selecting ? (
            <button
              key={a.id}
              type="button"
              onClick={() => toggle(a.id)}
              aria-pressed={selected.has(a.id)}
              className={cx("relative overflow-hidden rounded-xl border-2 bg-white text-left", selected.has(a.id) ? "border-bad" : "border-line")}
            >
              <div className="relative aspect-[9/16] bg-canvas">
                {a.thumb_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.thumb_url} alt={a.subject ?? "Shop photo"} className={cx("h-full w-full object-cover", selected.has(a.id) && "opacity-70")} />
                )}
                <span className={cx("absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full border-2 text-sm font-bold", selected.has(a.id) ? "border-bad bg-bad text-white" : "border-white bg-black/30 text-transparent")}>✓</span>
              </div>
              <p className="truncate p-3 text-xs text-muted">{a.subject ?? a.original_filename ?? "Photo"}</p>
            </button>
          ) : (
            <PhotoCard key={a.id} a={a} />
          ),
        )}
      </div>
    </div>
  );
}

function PhotoCard({ a }: { a: Photo }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cx("overflow-hidden rounded-xl border border-line bg-white", busy && "opacity-60")}>
      <div className="relative aspect-[9/16] bg-canvas">
        {a.thumb_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={a.thumb_url} alt={a.subject ?? "Shop photo"} className="h-full w-full object-cover" />
        )}
        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          {a.tag_status === "pending" && <Badge tone="brand" className="animate-pulse-soft">Tagging…</Badge>}
          {a.tag_status === "failed" && <Badge tone="bad">Tagging failed</Badge>}
          {a.tag_status === "tagged" && !a.usable && <Badge tone="bad">Not usable</Badge>}
          {a.faces_visible && <Badge tone="warn">Faces</Badge>}
        </div>
      </div>
      <div className="space-y-2 p-3 text-xs">
        {a.tag_status === "tagged" ? (
          <>
            <p className="line-clamp-2 font-medium text-ink">{a.subject}</p>
            <div className="flex flex-wrap gap-1">
              <Badge tone="brand">{labelFor(a.area ?? "other")}</Badge>
              <Badge>{labelFor(a.angle ?? "")}</Badge>
            </div>
          </>
        ) : (
          <p className="text-muted">{a.tag_status === "failed" ? (a.tag_error ?? "Could not tag this photo.") : "Claude is looking at this photo."}</p>
        )}
        {a.quality_flags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {a.quality_flags.map((f) => (
              <Badge key={f} tone="warn">{FLAG_TEXT[f] ?? labelFor(f)}</Badge>
            ))}
          </div>
        )}
        {editing && (
          <select
            defaultValue={a.area ?? "other"}
            onChange={(e) => act(() => call(`/api/assets/${a.id}`, { method: "PATCH", json: { area: e.target.value, shot_slot: e.target.value } }))}
            className="w-full rounded-md border border-line px-2 py-1"
          >
            {AREAS.map((x) => (
              <option key={x} value={x}>{labelFor(x)}</option>
            ))}
          </select>
        )}
        <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-muted">
          {a.tag_status === "tagged" && (
            <button className="hover:text-ink" onClick={() => setEditing((v) => !v)}>{editing ? "Done" : "Fix tag"}</button>
          )}
          {a.tag_status === "tagged" && (
            <button className="hover:text-ink" onClick={() => act(() => call(`/api/assets/${a.id}`, { method: "PATCH", json: { usable: !a.usable } }))}>
              {a.usable ? "Mark unusable" : "Mark usable"}
            </button>
          )}
          {a.tag_status !== "tagged" && (
            <button className="hover:text-ink" onClick={() => act(() => call(`/api/assets/${a.id}/retag`, { method: "POST" }))}>Retry tagging</button>
          )}
          <button
            className="text-bad/80 hover:text-bad"
            onClick={() => confirm("Delete this photo? Storyboards that use it will need a new photo.") && act(() => call(`/api/assets/${a.id}`, { method: "DELETE" }))}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
