import { Badge, Card, LinkButton, PageHeader } from "@/components/ui";

/** FR-31 (P2): Automatic Mode is deferred until the PM defines it (PRD 3.3, 11.2). */
export default function MarketingPage() {
  return (
    <>
      <PageHeader title="Marketing" subtitle="Automatic video ideas for your shop." />
      <Card className="max-w-2xl p-6">
        <Badge tone="brand">Coming later</Badge>
        <h2 className="mt-3 text-lg font-semibold">Automatic Mode</h2>
        <p className="mt-2 text-sm text-muted">
          Rample will suggest ready-made video concepts on a schedule or from local trends, using the same storyboard, model routing, approval and quality checks as Content Studio.
          You will still approve every video before any credits are spent.
        </p>
        <p className="mt-3 text-sm text-muted">Until then, make a video in Content Studio from a one-line idea.</p>
        <div className="mt-5">
          <LinkButton href="/studio">Go to Content Studio</LinkButton>
        </div>
      </Card>
    </>
  );
}
