"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { call } from "@/lib/client";
import { btn, cx } from "./ui";

export function ReviewActions({ qaId, kind, candidates, hasClip }: { qaId: string; kind: string; candidates: { id: string; name: string }[]; hasClip: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [model, setModel] = useState(candidates[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  async function decide(decision: string) {
    setBusy(true);
    try {
      await call(`/api/review/${qaId}`, { method: "POST", json: { decision, note, modelId: model } });
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4 lg:flex-row lg:items-center">
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (shown in the audit log)" className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-sm" />
      <div className="flex flex-wrap gap-2">
        <button disabled={busy || !hasClip} onClick={() => decide("approved")} className={cx(btn.base, btn.primary)}>Approve</button>
        <button disabled={busy} onClick={() => decide("rejected")} className={cx(btn.base, btn.danger)}>Reject</button>
        {kind === "scene" ? (
          <span className="flex gap-1">
            <select value={model} onChange={(e) => setModel(e.target.value)} className="rounded-lg border border-line px-2 text-sm">
              {candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button disabled={busy || !model} onClick={() => decide("rerender")} className={cx(btn.base, btn.secondary)}>Re-render</button>
          </span>
        ) : (
          <button disabled={busy} onClick={() => decide("rerender")} className={cx(btn.base, btn.secondary)}>Re-assemble</button>
        )}
      </div>
    </div>
  );
}

export function GradeButtons({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const grade = async (g: "agree" | "disagree") => {
    setBusy(true);
    await call(`/api/router-decisions/${id}/grade`, { method: "POST", json: { grade: g } }).catch((e) => alert(e.message));
    setBusy(false);
    router.refresh();
  };
  return (
    <div className="flex shrink-0 gap-2">
      <button disabled={busy} onClick={() => grade("agree")} className={cx(btn.base, btn.secondary, "py-1")}>Agree</button>
      <button disabled={busy} onClick={() => grade("disagree")} className={cx(btn.base, btn.secondary, "py-1")}>Disagree</button>
    </div>
  );
}
