import { requirePageStaff } from "@/lib/server/auth";
import { computeMetrics } from "@/lib/server/pipeline/metrics";
import { Badge, Card, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function MetricsPage() {
  await requirePageStaff();
  const metrics = await computeMetrics();
  return (
    <>
      <PageHeader title="Success metrics" subtitle="PRD section 10, computed live from storyboard versions, router decisions, render jobs and QA results." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((m) => (
          <Card key={m.name}>
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold">{m.name}</p>
              {m.ok !== null && <Badge tone={m.ok ? "good" : "warn"}>{m.ok ? "On target" : "Below target"}</Badge>}
            </div>
            <p className="mt-3 text-2xl font-bold tracking-tight">{m.value}</p>
            <p className="mt-2 text-xs text-muted">{m.definition}</p>
            <p className="mt-1 text-xs text-muted">Target: {m.target}</p>
          </Card>
        ))}
      </div>
    </>
  );
}
