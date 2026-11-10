"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { call } from "@/lib/client";
import { btn, Card, cx } from "./ui";

const EXAMPLES = ["$25 Tuesday Fade special", "We now do balayage", "Before and after: beard sculpting", "Walk-ins welcome this Saturday"];

export function NewVideoForm({ disabled, services }: { disabled: boolean; services: string[] }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { project } = await call<{ project: { id: string } }>("/api/projects", { method: "POST", json: { prompt } });
      router.push(`/studio/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  const ideas = [...EXAMPLES.slice(0, 2), ...services.slice(0, 2).map((s) => `Promote our ${s}`)];
  return (
    <Card className="p-6">
      <form onSubmit={submit}>
        <label htmlFor="prompt" className="text-sm font-semibold">New full video</label>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <input
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={disabled || busy}
            maxLength={1000}
            placeholder="$25 Tuesday Fade special"
            className="min-w-0 flex-1 rounded-xl border border-line px-4 py-3 text-base outline-none focus:border-brand disabled:bg-canvas"
          />
          <button disabled={disabled || busy || prompt.trim().length < 3} className={cx(btn.base, btn.primary, "px-6 py-3")}>
            {busy ? "Writing brief…" : "Create video"}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {ideas.map((x) => (
            <button key={x} type="button" disabled={disabled || busy} onClick={() => setPrompt(x)} className="rounded-full border border-line px-3 py-1 text-xs text-muted hover:border-brand hover:text-brand disabled:opacity-50">
              {x}
            </button>
          ))}
        </div>
        {busy && <p className="mt-3 text-sm text-muted">Claude is turning your idea into a brief using your profile and photos…</p>}
        {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      </form>
    </Card>
  );
}
