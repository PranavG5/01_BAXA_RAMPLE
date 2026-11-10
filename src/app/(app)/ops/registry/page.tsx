import { requirePageStaff } from "@/lib/server/auth";
import { providerStatus } from "@/lib/server/providers";
import { loadPins, loadRegistry } from "@/lib/server/pipeline/registry";
import { isStale } from "@/lib/core/routing-rules";
import { Badge, PageHeader } from "@/components/ui";
import { RegistryEditor } from "@/components/RegistryEditor";

export const dynamic = "force-dynamic";

/** FR-11, FR-15, FR-17: model registry with evaluations, kill switch, pins and staleness. */
export default async function RegistryPage() {
  await requirePageStaff();
  const [{ models, version, windowDays }, pins] = await Promise.all([loadRegistry(), loadPins()]);
  const status = providerStatus();
  return (
    <>
      <PageHeader
        title="Model registry"
        subtitle={`Claude routes animated scenes only to enabled models that are not marked "not usable". Every change bumps the registry version (now v${version}), and each routing decision records the version it used.`}
        action={
          <div className="flex flex-wrap gap-2">
            <Badge tone={status.mode === "mock" ? "warn" : "good"}>Media: {status.mode}</Badge>
            <Badge tone={status.higgsfield ? "good" : "bad"}>Higgsfield {status.higgsfield ? "connected" : "no key"}</Badge>
            <Badge tone={status.pika ? "good" : "bad"}>Pika {status.pika ? "connected" : "no key"}</Badge>
          </div>
        }
      />
      <RegistryEditor
        models={models.map((m) => ({ ...m, stale: isStale(m, windowDays) }))}
        pins={Object.fromEntries(pins)}
        windowDays={windowDays}
      />
    </>
  );
}
