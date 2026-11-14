"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { call } from "@/lib/client";
import { btn, cx } from "./ui";

/**
 * Deletes a video project: its storyboards, animated clips and finished video.
 * Photos in the library are kept. Works in any state; renders in progress stop.
 */
export function DeleteProjectButton({
  projectId,
  title,
  redirectTo,
  variant = "link",
}: {
  projectId: string;
  title: string;
  redirectTo?: string;
  variant?: "link" | "button";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    const ok = confirm(
      `Delete “${title}”?\n\nThis removes its storyboard, animated clips and finished video for good. Your photos stay in the library.`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      await call(`/api/projects/${projectId}`, { method: "DELETE" });
      if (redirectTo) router.push(redirectTo);
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not delete");
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={remove}
      className={variant === "button" ? cx(btn.base, btn.danger) : "shrink-0 rounded-lg px-2 py-1 text-sm text-bad/80 hover:bg-bad/10 hover:text-bad disabled:opacity-50"}
      aria-label={`Delete ${title}`}
    >
      {busy ? "Deleting…" : "Delete"}
    </button>
  );
}
