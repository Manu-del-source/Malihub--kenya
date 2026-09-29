import Link from "next/link";
import type { Metadata } from "next";
import { Search, Store } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/empty-state";
import { AdminPagination, adminListHref } from "@/components/shell/admin/admin-pagination";
import { AccountStatusBadge, SellerVerificationBadge } from "@/components/shell/admin/admin-badges";
import { formatDate } from "@/components/shell/admin/admin-format";
import { requireAdministrator } from "@/lib/auth";
import { listAdminSellers } from "@/services/admin-service";
import { adminSellerListSchema, parseListParams, type RawSearchParams } from "@/lib/validations/admin";

/**
 * `/admin/sellers` — the seller verification workbench.
 *
 * The `verification` filter drives the real `SellerVerificationStatus`
 * enum (`UNVERIFIED | PENDING | VERIFIED | REJECTED`), which is what the
 * storefront already keys off (public seller listing APIs hide UNVERIFIED
 * sellers). Decisions themselves are made on the detail page; this list only
 * reads.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Sellers — admin" };

const VERIFICATION_OPTIONS = [
  { value: "PENDING", label: "Pending review" },
  { value: "UNVERIFIED", label: "Unverified" },
  { value: "VERIFIED", label: "Verified" },
  { value: "REJECTED", label: "Rejected" },
] as const;

export default async function AdminSellersPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requireAdministrator();

  const parsed = parseListParams(adminSellerListSchema, await searchParams);
  const filters = parsed ?? { page: 1 };

  const { sellers, total, pageSize } = await listAdminSellers(filters);
  const current = { q: filters.q ?? "", verification: filters.verification ?? "" };

  return (
    <Container className="flex flex-col gap-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-medium">Sellers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total.toLocaleString()} seller profile{total === 1 ? "" : "s"} matching the current
            filters
          </p>
        </div>
      </header>

      <form className="glass-sm flex flex-wrap items-end gap-3 rounded-2xl p-4" method="GET">
        <label className="text-sm">
          <span className="text-muted-foreground">Search</span>
          <Input
            type="search"
            name="q"
            defaultValue={current.q}
            maxLength={120}
            placeholder="Business name or owner email"
            className="mt-1 w-72"
          />
        </label>
        <label className="text-sm">
          <span className="text-muted-foreground">Verification</span>
          <select
            name="verification"
            defaultValue={current.verification}
            className="mt-1 block h-11 w-44 rounded-xl border border-border bg-background/60 px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">All statuses</option>
            {VERIFICATION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" size="sm">
          <Search className="h-4 w-4" aria-hidden />
          Apply
        </Button>
        {(current.q || current.verification) && (
          <Link
            href="/admin/sellers"
            className="self-center text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            Clear filters
          </Link>
        )}
      </form>

      {sellers.length === 0 ? (
        <EmptyState
          icon={Store}
          title={current.q || current.verification ? "No sellers match these filters." : "No seller profiles yet."}
          description={
            current.q || current.verification
              ? "Try a broader search or clear the filters."
              : "Sellers appear once accounts complete onboarding as a seller or press “Start selling”."
          }
        />
      ) : (
        <div className="glass flex flex-col divide-y divide-border rounded-2xl">
          {sellers.map((seller) => (
            <Link
              key={seller.id}
              href={`/admin/sellers/${seller.id}`}
              className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/40"
            >
              <span
                aria-hidden
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold text-primary-400"
              >
                {seller.businessName.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{seller.businessName}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {seller.user.email}
                  {seller.county ? ` · ${seller.county}` : ""} · /{seller.slug}
                </span>
              </span>
              <span className="hidden shrink-0 items-center gap-2 sm:flex">
                <SellerVerificationBadge status={seller.verificationStatus} />
                <AccountStatusBadge isActive={seller.user.isActive} isBanned={seller.user.isBanned} />
              </span>
              <span className="shrink-0 text-right text-xs text-muted-foreground">
                <span className="block font-mono tabular-nums text-foreground/80">
                  {seller._count.products} listings · {seller._count.orders} orders
                </span>
                Joined {formatDate(seller.createdAt)}
              </span>
            </Link>
          ))}
        </div>
      )}

      <AdminPagination
        page={filters.page}
        pageSize={pageSize}
        total={total}
        label="sellers"
        buildHref={(page) => adminListHref("/admin/sellers", current, page)}
      />
    </Container>
  );
}
