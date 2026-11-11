import Link from "next/link";
import { requirePageUser } from "@/lib/server/auth";
import { signedUrls } from "@/lib/server/storage";
import { db, must } from "@/lib/server/db";
import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { DisclosureGuide } from "@/components/DisclosureGuide";
import { VideoActions } from "@/components/VideoActions";

interface Row {
  id: string;
  project_id: string;
  file_path: string;
  poster_path: string | null;
  duration_s: number | null;
  export_count: number;
  created_at: string;
  projects: { title: string; original_prompt: string };
}

/** FR-29: only QA-passed videos appear here. */
export default async function DashboardPage() {
  const { business } = await requirePageUser();
  const projects = must(await db().from("projects").select("id, title, original_prompt").eq("business_id", business.id), "projects") as { id: string; title: string; original_prompt: string }[];
  const byId = new Map(projects.map((p) => [p.id, p]));
  const finals = must(
    await db()
      .from("final_videos")
      .select("id, project_id, file_path, poster_path, duration_s, export_count, created_at")
      .in("project_id", projects.map((p) => p.id))
      .eq("status", "passed")
      .order("created_at", { ascending: false }),
    "videos",
  ) as Omit<Row, "projects">[];
  const rows: Row[] = finals.map((f) => ({ ...f, projects: { title: byId.get(f.project_id)?.title ?? "", original_prompt: byId.get(f.project_id)?.original_prompt ?? "" } }));
  const urls = await signedUrls("media", rows.flatMap((r) => [r.file_path, r.poster_path ?? ""]), 3600);

  return (
    <>
      <PageHeader title="Your videos" subtitle="Every video here passed automated quality checks (and a human review when needed)." action={<LinkButton href="/studio">New video</LinkButton>} />
      {rows.length === 0 ? (
        <EmptyState title="No finished videos yet" body="Approve a storyboard in Content Studio. Finished videos show up here after quality checks." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((r) => (
              <div key={r.id} className="overflow-hidden rounded-2xl border border-line bg-white">
                <video src={urls.get(r.file_path)} poster={r.poster_path ? urls.get(r.poster_path) : undefined} controls playsInline preload="metadata" className="aspect-[9/16] w-full bg-black" />
                <div className="space-y-2 p-4">
                  <Link href={`/studio/${r.project_id}`} className="block truncate font-semibold hover:underline">{r.projects.title || r.projects.original_prompt}</Link>
                  <p className="text-xs text-muted">
                    {r.duration_s ? `${Number(r.duration_s).toFixed(1)}s · ` : ""}
                    {new Date(r.created_at).toLocaleDateString()} · exported {r.export_count}×
                  </p>
                  <VideoActions id={r.id} />
                </div>
              </div>
            ))}
          </div>
          <div>
            <DisclosureGuide />
          </div>
        </div>
      )}
    </>
  );
}
