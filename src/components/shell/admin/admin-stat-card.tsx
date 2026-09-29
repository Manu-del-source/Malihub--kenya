import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/utils";

/**
 * Metric tile for the admin overview. A tile links out to the pre-filtered
 * admin list when `href` is given, so every number is one click from the
 * rows behind it. No `href`, no link. Values are always real aggregates —
 * zero renders as zero.
 */
export function AdminStatCard({
  label,
  value,
  hint,
  icon: Icon,
  href,
  tone = "default",
}: {
  label: string;
  value: number | string;
  hint?: string;
  icon: LucideIcon;
  href?: string;
  tone?: "default" | "attention" | "success";
}) {
  const body = (
    <>
      <div
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-lg",
          tone === "attention"
            ? "bg-warning/15 text-warning"
            : tone === "success"
              ? "bg-cyan/15 text-cyan"
              : "bg-primary/10 text-primary-400"
        )}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </div>
      <p className="mt-3 font-mono text-2xl font-medium tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
      {hint && <p className="mt-1 text-[11px] leading-snug text-muted-foreground/80">{hint}</p>}
    </>
  );

  const className =
    "block h-full rounded-xl border border-border bg-card p-5 transition-colors";

  if (href) {
    return (
      <Link href={href} className={cn(className, "hover:border-primary/40")}>
        {body}
      </Link>
    );
  }
  return <div className={className}>{body}</div>;
}
