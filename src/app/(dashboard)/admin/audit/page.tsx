import Link from "next/link";
import type { Metadata } from "next";
import { ScrollText, Search } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { AdminPagination, adminListHref } from "@/components/shell/admin/admin-pagination";
import { formatDateTime } from "@/components/shell/admin/admin-format";
import { requireAdministrator } from "@/lib/auth";
import { listAdminAuditEvents } from "@/services/admin-service";
import {
  adminAuditListSchema,
  parseListParams,
  type RawSearchParams,
} from "@/lib/validations/admin";
import { timeAgo } from "@/utils";

/**
 * `/admin/audit` — the append-only security & admin trail
 * (`audit_logs`, written exclusively through `src/services/audit-service.ts`
 * per that module's contract: sign-in failures, moderation decisions,
 * verification decisions, category changes — nothing else can write here, and
 * nothing updates or deletes rows after the fact).
 *
 * `metadata` is rendered as-is: the service documents that secrets never go
 * into it (the schema comment says the same), so this screen — like the
 * table — never holds passwords, tokens, or raw payment payloads. Ids shown
 * are MaliHub application ids with deep links into the admin records.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Audit log — admin" };

const TARGET_LINKS: Record<string, (id: string) => string> = {
  user: (id) => `/admin/users/${id}`,
  seller: (id) => `/admin/sellers/${id}`,
  listing: (id) => `/admin/listings/${id}`,
  // Categories have no detail page — the list IS the category surface.
  category: () => `/admin/categories`,
};

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requireAdministrator();

  const parsed = parseListParams(adminAuditListSchema, await searchParams);
  const filters = parsed ?? { page: 1 };

  const { events, total, pageSize } = await listAdminAuditEvents(filters);
  const current = { q: filters.q ?? "" };

  return (
    <Container className="flex flex-col gap-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-medium">Audit log</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total.toLocaleString()} recorded event{total === 1 ? "" : "s"} · append-only
          </p>
        </div>
      </header>

      <form className="glass-sm flex flex-wrap items-end gap-3 rounded-2xl p-4" method="GET">
        <label className="text-sm">
          <span className="text-muted-foreground">Filter</span>
          <Input
            type="search"
            name="q"
            defaultValue={current.q}
            maxLength={120}
            placeholder="Action or actor email (e.g. moderation.seller_verified)"
            className="mt-1 w-96 max-w-full"
          />
        </label>
        <Button type="submit" size="sm">
          <Search className="h-4 w-4" aria-hidden />
          Apply
        </Button>
        {current.q && (
          <Link
            href="/admin/audit"
            className="self-center text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            Clear
          </Link>
        )}
      </form>

      {events.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={current.q ? "No events match that filter." : "The audit trail is empty."}
          description={
            current.q
              ? "Try a shorter fragment — matching is over the action name and the actor's email."
              : "Sign-in failures and privileged admin decisions will appear here as they happen."
          }
        />
      ) : (
        <div className="glass flex flex-col divide-y divide-border rounded-2xl">
          {events.map((event) => {
            const link =
              event.targetId && event.targetType
                ? TARGET_LINKS[event.targetType]?.(event.targetId)
                : undefined;
            const metadataText = event.metadata ? JSON.stringify(event.metadata) : null;
            return (
              <div key={event.id} className="flex flex-wrap items-start gap-x-6 gap-y-2 px-5 py-4">
                <div className="min-w-40 shrink-0">
                  <p className="font-mono text-xs text-foreground/80">{formatDateTime(event.createdAt)}</p>
                  <p className="text-[11px] text-muted-foreground">{timeAgo(event.createdAt)}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <Badge variant="glass" className="font-mono text-[11px]">
                      {event.action}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      by {event.actorEmail ?? <span className="italic">unknown / pre-auth</span>}
                    </span>
                  </p>
                  {event.targetType && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      on <span className="uppercase">{event.targetType}</span>{" "}
                      {link && event.targetId ? (
                        <Link href={link} className="font-mono text-primary-400 underline-offset-2 hover:underline">
                          {event.targetId.slice(0, 8)}…
                        </Link>
                      ) : event.targetId ? (
                        <span className="font-mono">{event.targetId.slice(0, 8)}…</span>
                      ) : null}
                    </p>
                  )}
                  {metadataText && (
                    <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground/80" title={metadataText}>
                      {metadataText}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AdminPagination
        page={filters.page}
        pageSize={pageSize}
        total={total}
        label="audit events"
        buildHref={(page) => adminListHref("/admin/audit", current, page)}
      />
    </Container>
  );
}
