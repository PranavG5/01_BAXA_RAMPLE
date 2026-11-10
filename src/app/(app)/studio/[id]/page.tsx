import { requirePageUser } from "@/lib/server/auth";
import { listAssets } from "@/lib/server/pipeline/assets";
import { loadProject } from "@/lib/server/pipeline/projects";
import { projectSnapshot } from "@/lib/server/pipeline/snapshot";
import { signedUrls } from "@/lib/server/storage";
import { ProjectWorkspace } from "@/components/workspace/ProjectWorkspace";
import { HttpError } from "@/lib/server/http";
import { notFound } from "next/navigation";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { business } = await requirePageUser();
  const { id } = await params;
  let project;
  try {
    project = await loadProject(business, id);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  }
  const [snapshot, assets] = await Promise.all([projectSnapshot(business, project), listAssets(business.id)]);
  const tagged = assets.filter((a) => a.tag_status === "tagged");
  const thumbs = await signedUrls("assets", tagged.flatMap((a) => [a.thumb_path ?? "", a.vertical_path ?? ""]), 3600);
  const library = tagged.map((a) => ({
    id: a.id,
    thumb_url: a.thumb_path ? (thumbs.get(a.thumb_path) ?? null) : null,
    photo_url: a.vertical_path ? (thumbs.get(a.vertical_path) ?? null) : null,
    subject: a.subject ?? "",
    area: a.area ?? "other",
    usable: a.usable,
  }));
  return <ProjectWorkspace initial={snapshot} library={library} brand={{ primary: business.brand_colors[0] ?? "#111111", accent: business.brand_colors[1] ?? "#F5C518", name: business.name, booking: business.booking_link }} />;
}
