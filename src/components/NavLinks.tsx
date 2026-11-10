"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

const OWNER = [
  { href: "/studio", label: "Content Studio" },
  { href: "/library", label: "Photos" },
  { href: "/profile", label: "Profile" },
  { href: "/dashboard", label: "Videos" },
  { href: "/marketing", label: "Marketing" },
];
const STAFF = [
  { href: "/ops/review", label: "Review" },
  { href: "/ops/registry", label: "Registry" },
  { href: "/ops/metrics", label: "Metrics" },
];

export function NavLinks({ staff }: { staff: boolean }) {
  const path = usePathname();
  const links = staff ? [...OWNER, ...STAFF] : OWNER;
  return (
    <nav className="-mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto text-sm font-medium [scrollbar-width:none]">
      {links.map((l, i) => {
        const active = path === l.href || path.startsWith(`${l.href}/`);
        const opsStart = staff && i === OWNER.length;
        return (
          <Link
            key={l.href}
            href={l.href}
            className={cx(
              "shrink-0 rounded-lg px-3 py-1.5 whitespace-nowrap",
              active ? "bg-brand-soft text-brand-ink" : "text-muted hover:bg-canvas hover:text-ink",
              opsStart && "ml-2 border-l border-line pl-3",
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
