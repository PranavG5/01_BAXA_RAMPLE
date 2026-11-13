"use client";

import Link from "next/link";
import { useState } from "react";
import { USD_PER_CREDIT, labelFor } from "@/lib/core/vocabulary";
import { call } from "@/lib/client";
import { Badge, Card, Notice, btn, cx } from "../ui";
import { DisclosureGuide } from "../DisclosureGuide";
import { TREATMENT_LABEL, type ProjectSnapshot, type SceneView } from "./types";

const SCENE_STATUS: Record<string, { label: string; tone: "neutral" | "brand" | "good" | "warn" | "bad" }> = {
  pending: { label: "Waiting", tone: "neutral" },
  not_needed: { label: "Built in assembly", tone: "neutral" },
  rendering: { label: "Animating", tone: "brand" },
  qa: { label: "Quality check", tone: "brand" },
  passed: { label: "Passed QA", tone: "good" },
  needs_review: { label: "With a reviewer", tone: "warn" },
  rejected: { label: "Rejected", tone: "bad" },
  failed: { label: "Failed", tone: "bad" },
};

export function RenderPanel({ snap, onChange }: { snap: ProjectSnapshot; onChange: () => void }) {
  const version = snap.version!;
  const final = snap.finals[0];
  const delivered = snap.finals.find((f) => f.status === "passed");
  const [cap, setCap] = useState(String(Math.max(snap.credits.cap * 2, Math.ceil(snap.credits.committed + snap.credits.estimated))));
  const [busy, setBusy] = useState(false);

  const stage =
    version.state === "complete"
      ? "Your video is ready."
      : version.state === "failed"
        ? `This video could not be finished. ${version.failure_reason ?? ""}`
        : snap.project.status === "needs_review"
          ? "A Rample reviewer is checking part of this video. Nothing is published until it passes."
          : final?.status === "assembling"
            ? "Adding your text, voiceover, music and logo…"
            : version.state === "qa"
              ? "Running final checks…"
              : snap.scenes.length && snap.scenes.every((s) => ["passed", "not_needed"].includes(s.render_status))
                ? "All scenes are ready. Putting your video together…"
                : "Animating your scenes. Each one is quality checked against your original photo.";

  return (
    <Card className="p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Render</h2>
          <p className={cx("text-sm", version.state === "failed" ? "text-bad" : "text-muted")}>{stage}</p>
        </div>
        <div className="text-sm text-muted">
          Spent <b className="text-ink">{snap.credits.committed}</b> of {snap.credits.cap} credits (${(snap.credits.committed * USD_PER_CREDIT).toFixed(2)})
        </div>
      </div>

      {!delivered && snap.setupIssues.map((issue) => (
        <div key={issue} className="mt-4">
          <Notice>{issue}</Notice>
        </div>
      ))}

      {snap.credits.blockedByCap && (
        <div className="mt-4">
          <Notice>
            <p className="font-semibold">Credit cap reached</p>
            <p className="mt-1">A retry needs more credits than this video's cap allows. Raise the cap to continue, or leave it and a reviewer will take a look.</p>
            <div className="mt-3 flex gap-2">
              <input type="number" min={1} value={cap} onChange={(e) => setCap(e.target.value)} className="w-28 rounded-lg border border-line bg-white px-3 py-1.5 text-sm" />
              <button
                disabled={busy}
                className={cx(btn.base, btn.primary, "py-1.5")}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await call(`/api/projects/${snap.project.id}/cap`, { method: "PUT", json: { cap: Number(cap) } });
                    onChange();
                  } catch (e) {
                    alert(e instanceof Error ? e.message : "Could not update");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Raise cap
              </button>
            </div>
          </Notice>
        </div>
      )}

      {delivered?.video_url ? (
        <div className="mt-6 grid gap-6 md:grid-cols-[300px_1fr]">
          <video src={delivered.video_url} poster={delivered.poster_url ?? undefined} controls playsInline className="aspect-[9/16] w-full rounded-2xl bg-black" />
          <div className="space-y-4">
            <ExportButton videoId={delivered.id} />
            <Link href="/dashboard" className="block text-sm text-brand underline">See all your videos</Link>
            <DisclosureGuide />
          </div>
        </div>
      ) : (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {snap.scenes.map((s) => (
            <SceneProgress key={s.id} s={s} />
          ))}
          {final && (
            <div className="rounded-xl border border-line p-3 text-sm">
              <p className="font-semibold">Final assembly</p>
              <p className="mt-1 text-muted">
                {final.status === "assembling" && <span className="animate-pulse-soft">Composing 9:16 video…</span>}
                {final.status === "qa" && "Checking duration, size and audio…"}
                {final.status === "needs_review" && "With a reviewer."}
                {final.status === "failed" && `Retrying assembly${final.error ? `: ${final.error}` : ""}`}
                {final.status === "rejected" && "Rejected in review."}
              </p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function SceneProgress({ s }: { s: SceneView }) {
  const st = SCENE_STATUS[s.render_status] ?? { label: s.render_status, tone: "neutral" as const };
  const latest = s.jobs.at(-1);
  return (
    <div className="flex gap-3 rounded-xl border border-line p-3">
      <div className="h-24 w-14 shrink-0 overflow-hidden rounded-md bg-canvas">
        {s.clip_url ? (
          <video src={s.clip_url} muted autoPlay loop playsInline className="h-full w-full object-cover" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          s.photo_thumb_url && <img src={s.photo_thumb_url} alt="" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="min-w-0 text-xs">
        <p className="font-semibold">Scene {s.scene_order} · {labelFor(s.role)}</p>
        <p className="text-muted">{TREATMENT_LABEL[s.treatment]} · {Number(s.duration_s)}s</p>
        <div className="mt-1.5">
          <Badge tone={st.tone} className={s.render_status === "rendering" || s.render_status === "qa" ? "animate-pulse-soft" : undefined}>
            {st.label}
          </Badge>
        </div>
        {s.treatment === "animate" && latest && (
          <p className="mt-1 text-muted">
            Attempt {latest.attempt}
            {latest.status === "blocked" ? " · paused at credit cap" : ""}
            {s.reused_from_scene_id ? " · reused from earlier version" : ""}
          </p>
        )}
        {s.treatment === "animate" && !latest && s.reused_from_scene_id && <p className="mt-1 text-muted">Unchanged, reused from earlier version</p>}
      </div>
    </div>
  );
}

export function ExportButton({ videoId }: { videoId: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const { url } = await call<{ url: string }>(`/api/videos/${videoId}/export`, { method: "POST" });
          window.location.href = url;
        } catch (e) {
          alert(e instanceof Error ? e.message : "Export failed");
        } finally {
          setBusy(false);
        }
      }}
      className={cx(btn.base, btn.primary)}
    >
      {busy ? "Preparing…" : "Download MP4"}
    </button>
  );
}
