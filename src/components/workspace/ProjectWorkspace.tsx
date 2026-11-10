"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { call } from "@/lib/client";
import { StatusBadge, cx } from "../ui";
import { BriefPanel } from "./BriefPanel";
import { RenderPanel } from "./RenderPanel";
import { StoryboardPanel } from "./StoryboardPanel";
import type { Brand, LibraryPhoto, ProjectSnapshot } from "./types";

const LIVE = ["approved", "rendering", "qa", "needs_review"];
const STEPS = [
  { key: "brief", label: "Brief" },
  { key: "storyboard", label: "Storyboard" },
  { key: "render", label: "Render" },
  { key: "done", label: "Ready" },
];

function stepIndex(status: string) {
  if (status === "brief") return 0;
  if (status === "storyboard") return 1;
  if (status === "complete") return 3;
  if (status === "failed") return 1;
  return 2;
}

export function ProjectWorkspace({ initial, library, brand }: { initial: ProjectSnapshot; library: LibraryPhoto[]; brand: Brand }) {
  const [snap, setSnap] = useState(initial);
  const [viewVersion, setViewVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const projectId = snap.project.id;

  const refresh = useCallback(
    async (versionId?: string | null) => {
      try {
        const q = versionId ? `?version=${versionId}` : "";
        setSnap(await call<ProjectSnapshot>(`/api/projects/${projectId}/status${q}`));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not refresh");
      }
    },
    [projectId],
  );

  const live = LIVE.includes(snap.project.status);
  useEffect(() => {
    if (!live || viewVersion) return;
    const t = setInterval(() => refresh(), 4000);
    return () => clearInterval(t);
  }, [live, viewVersion, refresh]);

  const step = stepIndex(snap.project.status);
  const viewingOld = !!viewVersion && viewVersion !== snap.project.current_version_id;
  const showRender = !!snap.version && ["approved", "rendering", "qa", "complete", "failed"].includes(snap.version.state) && !viewingOld;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Link href="/studio" className="text-sm text-muted hover:text-ink">← Content Studio</Link>
          <h1 className="mt-1 truncate text-2xl font-bold tracking-tight">{snap.project.title || snap.project.original_prompt}</h1>
          <p className="mt-1 text-sm text-muted">“{snap.project.original_prompt}”</p>
        </div>
        <div className="shrink-0 self-start">
          <StatusBadge status={snap.project.status} />
        </div>
      </div>

      <ol className="grid grid-cols-4 gap-2">
        {STEPS.map((s, i) => (
          <li key={s.key} className="flex flex-col gap-1.5">
            <span className={cx("h-1.5 rounded-full", i < step ? "bg-brand" : i === step ? "bg-brand/60" : "bg-line")} />
            <span className={cx("text-xs font-medium", i <= step ? "text-ink" : "text-muted")}>{s.label}</span>
          </li>
        ))}
      </ol>

      {error && <p className="text-sm text-bad">{error}</p>}

      <BriefPanel snap={snap} onChange={() => refresh()} />

      {snap.version && (
        <StoryboardPanel
          snap={snap}
          library={library}
          brand={brand}
          viewingOld={viewingOld}
          onSelectVersion={(id) => {
            const next = id === snap.project.current_version_id ? null : id;
            setViewVersion(next);
            refresh(next);
          }}
          onChange={() => {
            setViewVersion(null);
            refresh();
          }}
        />
      )}

      {showRender && <RenderPanel snap={snap} onChange={() => refresh()} />}
    </div>
  );
}
