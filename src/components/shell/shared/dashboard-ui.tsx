import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { cn } from "@/utils";

/** Section title with a "see all" link — used above every list on a dashboard. */
export function SectionHeader({
  title,
  href,
  linkLabel = "See all",
  className,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex items-center justify-between gap-3", className)}>
      <h2 className="font-display text-lg font-medium sm:text-xl">{title}</h2>
      {href && (
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          {linkLabel}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      )}
    </div>
  );
}

/** Compact stat tile: icon beside the number, label underneath. */
export function StatTile({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  href?: string;
}) {
  const body = (
    <>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary-400">
        <Icon className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block font-mono text-xl font-semibold tabular-nums leading-tight">{value}</span>
        <span className="block truncate text-xs text-muted-foreground">{label}</span>
      </span>
    </>
  );
  const cls =
    "flex items-center gap-3 rounded-xl border border-border bg-card p-3.5 transition-colors";
  return href ? (
    <Link href={href} className={cn(cls, "hover:border-primary/40")}>{body}</Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** App-style icon shortcuts: round icon above a short label, 4 across. */
export function QuickActions({
  items,
}: {
  items: { label: string; href: string; icon: LucideIcon }[];
}) {
  return (
    <nav
      aria-label="Shortcuts"
      className="grid grid-cols-4 gap-2 rounded-xl border border-border bg-card px-2 py-4 sm:max-w-xl"
    >
      {items.map(({ label, href, icon: Icon }) => (
        <Link key={label} href={href} className="group flex flex-col items-center gap-2 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary-400 transition-all group-hover:bg-primary/20 group-active:scale-95">
            <Icon className="h-5 w-5" aria-hidden />
          </span>
          <span className="text-[12px] font-medium leading-tight">{label}</span>
        </Link>
      ))}
    </nav>
  );
}
