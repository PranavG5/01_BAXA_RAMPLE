"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { call } from "@/lib/client";
import { btn, Card, cx } from "./ui";

export function UploadPhotos() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [result, setResult] = useState<{ ok: number; failed: { name: string; error: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  function pick(list: FileList | null) {
    if (!list) return;
    setFiles(Array.from(list).filter((f) => f.type.startsWith("image/") || /\.(heic|heif|avif)$/i.test(f.name)).slice(0, 20));
    setResult(null);
  }

  async function upload() {
    setBusy(true);
    setError(null);
    setProgress(null);
    const created: string[] = [];
    const failed: { name: string; error: string }[] = [];
    try {
      // Photos go straight to storage when it supports that: requests to the
      // app itself are capped at 4.5 MB on Vercel.
      const plan = await call<{ direct: boolean; uploads?: { key: string; url: string }[] }>("/api/assets/uploads", {
        method: "POST",
        json: { files: files.map((f) => ({ name: f.name, size: f.size, type: f.type })) },
      });
      for (const [i, f] of files.entries()) {
        setProgress(`Uploading ${i + 1} of ${files.length}…`);
        try {
          if (plan.direct && plan.uploads?.[i]) {
            const target = plan.uploads[i];
            const put = await fetch(target.url, {
              method: "PUT",
              headers: { "content-type": f.type || "application/octet-stream", "x-upsert": "false" },
              body: f,
            });
            if (!put.ok) throw new Error(`Upload to storage failed (${put.status})`);
            const done = await call<{ id: string }>("/api/assets/uploads/complete", {
              method: "POST",
              json: { key: target.key, name: f.name, type: f.type, consent },
            });
            created.push(done.id);
          } else {
            const form = new FormData();
            form.append("files", f);
            form.append("consent", String(consent));
            const res = await call<{ created: string[]; failed: { name: string; error: string }[] }>("/api/assets", { method: "POST", body: form });
            created.push(...res.created);
            failed.push(...res.failed);
          }
        } catch (e) {
          failed.push({ name: f.name, error: e instanceof Error ? e.message : "Upload failed" });
        }
      }
      setResult({ ok: created.length, failed });
      setFiles([]);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <Card>
      <h2 className="font-semibold">Add photos</h2>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          pick(e.dataTransfer.files);
        }}
        className={cx("mt-3 flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center text-sm transition", drag ? "border-brand bg-brand-soft" : "border-line hover:border-brand/50")}
      >
        <span className="font-medium">{files.length ? `${files.length} photo(s) selected` : "Drop photos here or tap to choose"}</span>
        <span className="mt-1 text-xs text-muted">JPEG, PNG, WebP or AVIF, up to 20 MB each. Vertical shots work best.</span>
      </button>
      <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={(e) => pick(e.target.files)} />
      <label className="mt-4 flex items-start gap-2 text-xs text-muted">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 accent-brand" />
        <span>I own these photos or have permission to use them, and anyone recognizable in them (including clients) has agreed to appear in my ads.</span>
      </label>
      <button disabled={!files.length || !consent || busy} onClick={upload} className={cx(btn.base, btn.primary, "mt-4 w-full")}>
        {busy ? (progress ?? "Uploading…") : "Upload and tag"}
      </button>
      {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      {result && (
        <p className={cx("mt-3 text-sm", result.ok ? "text-good" : "text-bad")}>
          {result.ok ? `${result.ok} uploaded. Claude is tagging them now.` : "Nothing was uploaded."}
          {result.failed.map((f) => (
            <span key={f.name} className="block text-bad">
              {f.name}: {f.error}
            </span>
          ))}
        </p>
      )}
    </Card>
  );
}
