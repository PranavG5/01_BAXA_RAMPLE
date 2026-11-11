import Link from "next/link";
import { requirePageUser } from "@/lib/server/auth";
import { listAssets } from "@/lib/server/pipeline/assets";
import { db, must } from "@/lib/server/db";
import { libraryReadiness } from "@/lib/core/library";
import type { Project } from "@/lib/types";
import { EmptyState, LinkButton, Notice, PageHeader, StatusBadge } from "@/components/ui";
import { NewVideoForm } from "@/components/NewVideoForm";

export default async function StudioPage() {
  const { business } = await requirePageUser();
  const [assets, projects] = await Promise.all([
    listAssets(business.id),
    db().from("projects").select("*").eq("business_id", business.id).order("updated_at", { ascending: false }).limit(50),
  ]);
  const list = must(projects, "projects") as Project[];
  const readiness = libraryReadiness(assets);
  const profileIncomplete = !business.name || !business.booking_link;

  return (
    <>
      <PageHeader title="Content Studio" subtitle="Type one line. Review a storyboard built from your own photos. Approve it, and we handle the rest." />
      <div className="space-y-4">
        {!readiness.ready && (
          <Notice>
            Your photo library needs {readiness.missing.join(" and ")} before you can make videos.{" "}
            <Link href="/library" className="font-semibold underline">Add photos</Link>
          </Notice>
        )}
        {profileIncomplete && (
          <Notice tone="brand">
            Add your business name and booking link so videos end with the right call to action.{" "}
            <Link href="/profile" className="font-semibold underline">Edit profile</Link>
          </Notice>
        )}
        <NewVideoForm disabled={!readiness.ready} services={business.services.map((s) => `${s.name} ${s.price}`.trim())} />
      </div>

      <h2 className="mt-10 mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Your videos</h2>
      {list.length === 0 ? (
        <EmptyState title="No videos yet" body="Try something like “$25 Tuesday Fade special”." action={!readiness.ready ? <LinkButton href="/library">Add photos first</LinkButton> : undefined} />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-white">
          {list.map((p) => (
            <Link key={p.id} href={`/studio/${p.id}`} className="flex items-center gap-4 border-b border-line px-5 py-4 last:border-0 hover:bg-canvas">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{p.title || p.original_prompt}</p>
                <p className="truncate text-xs text-muted">“{p.original_prompt}” · {new Date(p.updated_at).toLocaleString()}</p>
              </div>
              <StatusBadge status={p.status} />
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
