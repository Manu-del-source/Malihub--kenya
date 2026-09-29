import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/utils";

/**
 * Build a list-page href from the current filter values (empty/undefined keys
 * are dropped, `page=1` stays implicit). Used both by the filter forms (to
 * link "clear") and by the pagination footer.
 */
export function adminListHref(
  basePath: string,
  params: Record<string, string | number | undefined>,
  page?: number
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "" || value === null) continue;
    search.set(key, String(value));
  }
  if (page && page > 1) search.set("page", String(page));
  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}

/**
 * Offset pagination footer for the admin list screens.
 *
 * Hrefs are rebuilt from the CURRENT query params (the caller passes the
 * already-parsed primitive map), so filtering and paging compose without any
 * client JS. `page` is the only key this rewrites.
 */
export function AdminPagination({
  page,
  pageSize,
  total,
  buildHref,
  label,
}: {
  page: number;
  pageSize: number;
  total: number;
  /** e.g. `/admin/users` — receives `?…&page=N` appended by the caller-side
   * serializer below. Returns the full href for the target page. */
  buildHref: (page: number) => string;
  label: string;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const hasPrev = page > 1;
  const hasNext = page < pageCount;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
      <p className="text-xs text-muted-foreground">
        {total === 0
          ? `No ${label}`
          : `${from}–${to} of ${total.toLocaleString()} ${label}`}
      </p>
      <div className="flex items-center gap-2">
        <PageLink href={hasPrev ? buildHref(page - 1) : null} direction="prev" />
        <span className="px-1 font-mono text-xs tabular-nums text-muted-foreground">
          {page} / {pageCount}
        </span>
        <PageLink href={hasNext ? buildHref(page + 1) : null} direction="next" />
      </div>
    </div>
  );
}

function PageLink({
  href,
  direction,
}: {
  href: string | null;
  direction: "prev" | "next";
}) {
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  const className = cn(
    "flex h-9 w-9 items-center justify-center rounded-full border border-border transition-colors",
    href
      ? "text-foreground hover:border-primary/50 hover:bg-primary/5"
      : "pointer-events-none opacity-40"
  );

  if (!href) {
    return (
      <span aria-disabled="true" aria-label={`No ${direction} page`} className={className}>
        <Icon className="h-4 w-4" aria-hidden />
      </span>
    );
  }

  return (
    <Link href={href} aria-label={`${direction} page`} className={className}>
      <Icon className="h-4 w-4" aria-hidden />
    </Link>
  );
}
