"use client";

import { useState } from "react";
import type { Brief } from "@/lib/core/schemas";
import { GOALS, PLATFORMS, labelFor } from "@/lib/core/vocabulary";
import { call } from "@/lib/client";
import { Badge, Card, Notice, btn, cx } from "../ui";
import type { ProjectSnapshot } from "./types";

const input = "mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand disabled:bg-canvas";

export function BriefPanel({ snap, onChange }: { snap: ProjectSnapshot; onChange: () => void }) {
  const { project } = snap;
  const locked = !!project.current_version_id;
  const [brief, setBrief] = useState<Brief | null>(project.brief);
  const [dirty, setDirty] = useState(false);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(!locked);

  if (!brief) return null;
  const set = <K extends keyof Brief>(k: K, v: Brief[K]) => {
    setBrief({ ...brief, [k]: v });
    setDirty(true);
  };

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  const saveBrief = () => call(`/api/projects/${project.id}/brief`, { method: "PUT", json: { brief } }).then(() => setDirty(false));
  const questionOpen = !!project.clarifying_question && !project.clarifying_answer && !locked;

  if (locked) {
    return (
      <Card>
        <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen(!open)}>
          <span className="font-semibold">Brief</span>
          <span className="text-sm text-muted">{open ? "Hide" : "Show"}</span>
        </button>
        {open && (
          <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            {(
              [
                ["Goal", labelFor(brief.goal)],
                ["Offer", brief.offer || "None"],
                ["Audience", brief.audience],
                ["Tone", brief.tone],
                ["Platform", labelFor(brief.platform)],
                ["Length", `${brief.target_length_s}s`],
                ["Hook", brief.hook_idea],
                ["Call to action", brief.call_to_action],
              ] as const
            ).map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Your brief</h2>
          <p className="text-sm text-muted">Claude expanded your idea. Edit anything before the storyboard is written.</p>
        </div>
        <Badge tone="brand">Step 1</Badge>
      </div>

      {project.brief_warnings.map((w) => (
        <div key={w} className="mt-4">
          <Notice>{w}</Notice>
        </div>
      ))}

      {questionOpen && (
        <div className="mt-4 rounded-xl border border-brand/20 bg-brand-soft p-4">
          <p className="text-sm font-semibold text-brand-ink">One quick question</p>
          <p className="mt-1 text-sm">{project.clarifying_question}</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input className={cx(input, "mt-0 flex-1 bg-white")} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Your answer" />
            <button disabled={!!busy || !answer.trim()} onClick={() => run("answer", () => call(`/api/projects/${project.id}/clarify`, { method: "POST", json: { answer } }))} className={cx(btn.base, btn.primary)}>
              {busy === "answer" ? "Updating…" : "Answer"}
            </button>
            <button disabled={!!busy} onClick={() => run("answer", () => call(`/api/projects/${project.id}/clarify`, { method: "POST", json: { answer: "" } }))} className={cx(btn.base, btn.ghost)}>
              Skip
            </button>
          </div>
        </div>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium sm:col-span-2">
          Title
          <input className={input} value={brief.title} onChange={(e) => set("title", e.target.value)} />
        </label>
        <label className="text-sm font-medium">
          Goal
          <select className={input} value={brief.goal} onChange={(e) => set("goal", e.target.value as Brief["goal"])}>
            {GOALS.map((g) => (
              <option key={g} value={g}>{labelFor(g)}</option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium">
          Offer
          <input className={input} value={brief.offer} onChange={(e) => set("offer", e.target.value)} placeholder="None" />
        </label>
        <label className="text-sm font-medium">
          Audience
          <input className={input} value={brief.audience} onChange={(e) => set("audience", e.target.value)} />
        </label>
        <label className="text-sm font-medium">
          Tone
          <input className={input} value={brief.tone} onChange={(e) => set("tone", e.target.value)} />
        </label>
        <label className="text-sm font-medium">
          Platform
          <select className={input} value={brief.platform} onChange={(e) => set("platform", e.target.value as Brief["platform"])}>
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>{labelFor(p)}</option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium">
          Target length (seconds)
          <input type="number" min={6} max={30} className={input} value={brief.target_length_s} onChange={(e) => set("target_length_s", Number(e.target.value))} />
        </label>
        <label className="text-sm font-medium sm:col-span-2">
          Hook idea (first 3 seconds)
          <input className={input} value={brief.hook_idea} onChange={(e) => set("hook_idea", e.target.value)} />
        </label>
        <label className="text-sm font-medium sm:col-span-2">
          Must-include facts (one per line)
          <textarea className={cx(input, "min-h-20")} value={brief.must_include_facts.join("\n")} onChange={(e) => set("must_include_facts", e.target.value.split("\n").filter((x) => x.trim()))} />
        </label>
        <label className="text-sm font-medium sm:col-span-2">
          Call to action
          <input className={input} value={brief.call_to_action} onChange={(e) => set("call_to_action", e.target.value)} />
        </label>
      </div>

      {error && <p className="mt-4 text-sm text-bad">{error}</p>}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          disabled={!!busy || questionOpen}
          onClick={() =>
            run("storyboard", async () => {
              if (dirty) await saveBrief();
              await call(`/api/projects/${project.id}/storyboard`, { method: "POST" });
            })
          }
          className={cx(btn.base, btn.primary)}
        >
          {busy === "storyboard" ? "Writing storyboard…" : "Write storyboard"}
        </button>
        {dirty && (
          <button disabled={!!busy} onClick={() => run("save", saveBrief)} className={cx(btn.base, btn.secondary)}>
            {busy === "save" ? "Saving…" : "Save brief"}
          </button>
        )}
        {questionOpen && <span className="text-xs text-muted">Answer or skip the question first.</span>}
        {busy === "storyboard" && <span className="text-xs text-muted">Choosing photos, writing scenes and picking a video model for each one. This takes about a minute.</span>}
      </div>
    </Card>
  );
}
