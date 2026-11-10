"use client";

import { useRouter } from "next/navigation";
import { call } from "@/lib/client";
import { ExportButton } from "./workspace/RenderPanel";
import { btn, cx } from "./ui";

export function VideoActions({ id }: { id: string }) {
  const router = useRouter();
  return (
    <div className="flex gap-2">
      <ExportButton videoId={id} />
      <button
        className={cx(btn.base, btn.danger)}
        onClick={async () => {
          if (!confirm("Delete this video permanently?")) return;
          await call(`/api/videos/${id}`, { method: "DELETE" }).catch((e) => alert(e.message));
          router.refresh();
        }}
      >
        Delete
      </button>
    </div>
  );
}
