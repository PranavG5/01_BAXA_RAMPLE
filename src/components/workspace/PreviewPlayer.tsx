"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cx } from "../ui";
import { EFFECT_ANIMATION, type Brand, type SceneView } from "./types";

/**
 * FR-9: free preview built from the owner's photos with text overlays mocked up.
 * AI motion cannot be previewed without spending credits, so animated scenes
 * show a gentle zoom and a label instead.
 */
export function PreviewPlayer({ scenes, brand, onClose }: { scenes: SceneView[]; brand: Brand; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [voice, setVoice] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const total = useMemo(() => scenes.reduce((s, x) => s + Number(x.duration_s), 0), [scenes]);
  const scene = scenes[index];
  const startOf = (i: number) => scenes.slice(0, i).reduce((s, x) => s + Number(x.duration_s), 0);

  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => {
      setElapsed((e) => {
        const next = e + 0.1;
        if (next >= total) {
          setPlaying(false);
          return total;
        }
        return next;
      });
    }, 100);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, total]);

  useEffect(() => {
    let i = 0;
    while (i < scenes.length - 1 && elapsed >= startOf(i + 1)) i++;
    if (i !== index) setIndex(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed]);

  useEffect(() => {
    if (!voice || !playing || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    if (scene?.voiceover) window.speechSynthesis.speak(new SpeechSynthesisUtterance(scene.voiceover));
    return () => window.speechSynthesis.cancel();
  }, [index, voice, playing, scene?.voiceover]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!scene) return null;
  const anim = scene.treatment === "animate" ? "kb-zoom-in" : (EFFECT_ANIMATION[scene.still_motion_effect ?? ""] ?? "kb-zoom-in");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="flex w-full max-w-[360px] flex-col gap-3" onClick={(e) => e.stopPropagation()}>
        <div className="relative aspect-[9/16] w-full overflow-hidden rounded-2xl bg-black shadow-2xl">
          {(scene.photo_url ?? scene.photo_thumb_url) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`${scene.id}-${index}`}
              src={scene.photo_url ?? scene.photo_thumb_url!}
              alt=""
              className={cx("h-full w-full object-cover", scene.treatment === "end_card" && "brightness-50")}
              style={{ animation: `${anim} ${Number(scene.duration_s)}s ease-out both`, animationPlayState: playing ? "running" : "paused" }}
            />
          )}
          <div className="absolute inset-x-0 top-0 flex gap-1 p-2">
            {scenes.map((s, i) => {
              const start = startOf(i);
              const pct = Math.max(0, Math.min(1, (elapsed - start) / Number(s.duration_s)));
              return (
                <div key={s.id} className="h-1 flex-1 overflow-hidden rounded-full bg-white/30">
                  <div className="h-full bg-white" style={{ width: `${pct * 100}%` }} />
                </div>
              );
            })}
          </div>
          {scene.treatment === "animate" && (
            <span className="absolute left-3 top-5 rounded-full bg-white/85 px-2 py-0.5 text-[11px] font-semibold text-brand-ink">AI motion renders after approval</span>
          )}
          {scene.on_screen_text && (
            <div key={`t-${index}`} className={cx("absolute inset-x-5 text-center text-2xl font-extrabold leading-tight text-white", scene.role === "hook" ? "top-[36%]" : scene.treatment === "end_card" ? "top-[42%]" : "top-[12%]")} style={{ animation: "fade-in 350ms ease both" }}>
              <span className="rounded-lg px-2 py-1 [box-decoration-break:clone] [text-shadow:0_2px_6px_rgba(0,0,0,.4)]" style={{ background: scene.role === "hook" || scene.treatment === "end_card" ? brand.primary : "transparent" }}>
                {scene.on_screen_text}
              </span>
            </div>
          )}
          {scene.treatment === "end_card" && brand.booking && (
            <div className="absolute inset-x-5 top-[62%] text-center text-sm font-bold">
              <span className="rounded px-2 py-1 text-black" style={{ background: brand.accent }}>{brand.booking.replace(/^https?:\/\//, "")}</span>
            </div>
          )}
          {scene.voiceover && scene.treatment !== "end_card" && (
            <div className="absolute inset-x-5 bottom-[10%] text-center text-sm font-semibold text-white">
              <span className="rounded bg-black/70 px-2 py-1 [box-decoration-break:clone]">{scene.voiceover}</span>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between text-sm text-white">
          <div className="flex gap-2">
            <button
              className="rounded-lg bg-white/15 px-3 py-1.5 font-semibold hover:bg-white/25"
              onClick={() => {
                if (elapsed >= total) {
                  setElapsed(0);
                  setIndex(0);
                }
                setPlaying(!playing);
              }}
            >
              {playing ? "Pause" : elapsed >= total ? "Replay" : "Play"}
            </button>
            <label className="flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5">
              <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} className="accent-white" /> Read voiceover
            </label>
          </div>
          <span className="tabular-nums text-white/70">{elapsed.toFixed(1)}s / {total}s</span>
        </div>
        <p className="text-center text-xs text-white/60">Free preview with your photos and text. Final voice, music and AI motion are added when you approve.</p>
        <button onClick={onClose} className="text-sm text-white/80 hover:text-white">Close</button>
      </div>
    </div>
  );
}
