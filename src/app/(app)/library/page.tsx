import { requirePageUser } from "@/lib/server/auth";
import { listAssets } from "@/lib/server/pipeline/assets";
import { signedUrls } from "@/lib/server/storage";
import { libraryReadiness } from "@/lib/core/library";
import { LIBRARY_MINIMUM } from "@/lib/core/vocabulary";
import { Badge, Card, PageHeader } from "@/components/ui";
import { UploadPhotos } from "@/components/UploadPhotos";
import { PhotoGrid } from "@/components/PhotoGrid";
import { AutoRefresh } from "@/components/AutoRefresh";

export default async function LibraryPage() {
  const { business } = await requirePageUser();
  const assets = await listAssets(business.id);
  const urls = await signedUrls("assets", assets.map((a) => a.thumb_path ?? ""), 3600);
  const readiness = libraryReadiness(assets);

  return (
    <>
      <PageHeader
        title="Photo library"
        subtitle="Every video is set in your real shop. Each scene starts from one of these photos, so the more angles you add, the better your videos look."
      />
      <AutoRefresh active={readiness.pendingTags > 0} />
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-6">
          <Card>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Shot checklist</h2>
              {readiness.ready ? <Badge tone="good">Ready for videos</Badge> : <Badge tone="warn">Not ready</Badge>}
            </div>
            <p className="mt-1 text-xs text-muted">
              Minimum: {LIBRARY_MINIMUM.photos} tagged photos covering {LIBRARY_MINIMUM.areas} areas. You have {readiness.taggedUsable} photos in {readiness.distinctAreas} areas.
            </p>
            <ul className="mt-4 space-y-3">
              {readiness.slots.map((s) => (
                <li key={s.slot} className="flex items-start gap-3">
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${s.filled ? "bg-good text-white" : "border border-line text-muted"}`}>
                    {s.filled ? "✓" : ""}
                  </span>
                  <div className="text-sm">
                    <p className="font-medium">
                      {s.label} {s.count > 1 && <span className="text-muted">×{s.count}</span>}
                    </p>
                    <p className="text-xs text-muted">
                      {s.hint}
                      {s.needsConsent && " Only with the client's consent."}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            {!readiness.ready && <p className="mt-4 text-xs font-medium text-warn">Still needed: {readiness.missing.join(", ")}.</p>}
          </Card>
          <UploadPhotos />
        </div>
        <PhotoGrid assets={assets.map((a) => ({ ...a, thumb_url: a.thumb_path ? (urls.get(a.thumb_path) ?? null) : null }))} />
      </div>
    </>
  );
}
