import Link from "next/link";
import type { ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export const btn = {
  base: "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
  primary: "bg-brand text-white hover:bg-brand-ink",
  secondary: "border border-line bg-white text-ink hover:bg-canvas",
  ghost: "text-muted hover:bg-canvas hover:text-ink",
  danger: "border border-bad/30 bg-white text-bad hover:bg-bad/5",
};

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]", className)}>{children}</div>;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

const tone = {
  neutral: "bg-canvas text-muted border-line",
  brand: "bg-brand-soft text-brand-ink border-brand/20",
  good: "bg-good/10 text-good border-good/20",
  warn: "bg-warn/10 text-warn border-warn/25",
  bad: "bg-bad/10 text-bad border-bad/20",
};

export function Badge({ children, tone: t = "neutral", className }: { children: ReactNode; tone?: keyof typeof tone; className?: string }) {
  return <span className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", tone[t], className)}>{children}</span>;
}

const STATUS: Record<string, { label: string; tone: keyof typeof tone }> = {
  brief: { label: "Brief", tone: "neutral" },
  storyboard: { label: "Storyboard", tone: "brand" },
  approved: { label: "Approved", tone: "brand" },
  rendering: { label: "Rendering", tone: "brand" },
  qa: { label: "Final checks", tone: "brand" },
  needs_review: { label: "In review", tone: "warn" },
  complete: { label: "Ready", tone: "good" },
  failed: { label: "Needs changes", tone: "bad" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function EmptyState({ title, body, action }: { title: string; body: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-white px-6 py-12 text-center">
      <p className="font-semibold">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Notice({ tone: t = "warn", children }: { tone?: "warn" | "bad" | "good" | "brand"; children: ReactNode }) {
  const styles = {
    warn: "border-warn/25 bg-warn/5 text-[#7a4a00]",
    bad: "border-bad/25 bg-bad/5 text-bad",
    good: "border-good/25 bg-good/5 text-good",
    brand: "border-brand/20 bg-brand-soft text-brand-ink",
  };
  return <div className={cx("rounded-xl border px-4 py-3 text-sm", styles[t])}>{children}</div>;
}

export function LinkButton({ href, children, variant = "primary" }: { href: string; children: ReactNode; variant?: "primary" | "secondary" }) {
  return (
    <Link href={href} className={cx(btn.base, btn[variant])}>
      {children}
    </Link>
  );
}
