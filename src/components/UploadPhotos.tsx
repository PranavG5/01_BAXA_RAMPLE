"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
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

  function pick(list: FileList | null) {
    if (!list) return;
    setFiles(Array.from(list).filter((f) => f.type.startsWith("image/") || /\.(heic|heif|avif)$/i.test(f.name)).slice(0, 20));
    setResult(null);
  }

  async function upload() {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      files.forEach((f) => form.append("files", f));
      form.append("consent", String(consent));
      const res = await fetch("/api/assets", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setResult({ ok: data.created.length, failed: data.failed });
      setFiles([]);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
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
        {busy ? "Uploading…" : "Upload and tag"}
      </button>
      {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      {result && (
        <p className="mt-3 text-sm text-good">
          {result.ok} uploaded. Claude is tagging them now.
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
