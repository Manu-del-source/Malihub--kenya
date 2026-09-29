import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { Search, Tags } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/empty-state";
import { AdminPagination, adminListHref } from "@/components/shell/admin/admin-pagination";
import { SellerVerificationBadge } from "@/components/shell/admin/admin-badges";
import { ListingStatusBadge } from "@/components/shell/seller/listing-status-badge";
import { timeAgo, formatKes } from "@/utils";
import { requireAdministrator } from "@/lib/auth";
import { listAdminListings } from "@/services/admin-service";
import { prisma } from "@/lib/prisma";
import {
  adminListingListSchema,
  parseListParams,
  type RawSearchParams,
} from "@/lib/validations/admin";

/**
 * `/admin/listings` — moderation queue and full catalogue search.
 *
 * Unlike the public marketplace search (which is a full-text tsvector feed
 * restricted to ACTIVE listings — see `search-service.ts`), the admin list
 * must reach EVERY status including DRAFT and REMOVED, so it queries Prisma
 * directly with `contains` matching over the validated, capped search text.
 * Status/category/seller filters map 1:1 onto real columns; nothing here
 * invents a second visibility model (the one source of truth stays
 * `src/lib/listing-visibility.ts`).
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Listings — admin" };

const STATUS_OPTIONS = [
  "DRAFT",
  "PENDING_REVIEW",
  "ACTIVE",
  "SOLD",
  "ARCHIVED",
  "SUSPENDED",
  "REMOVED",
] as const;

export default async function AdminListingsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requireAdministrator();

  const parsed = parseListParams(adminListingListSchema, await searchParams);
  const filters = parsed ?? { page: 1 };

  const [{ listings, total, pageSize }, categories] = await Promise.all([
    listAdminListings(filters),
    prisma.category.findMany({
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, slug: true },
      take: 200,
    }),
  ]);

  const current = {
    q: filters.q ?? "",
    status: filters.status ?? "",
    category: filters.category ?? "",
    seller: filters.seller ?? "",
  };

  return (
    <Container className="flex flex-col gap-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-medium">Listings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total.toLocaleString()} listing{total === 1 ? "" : "s"} matching the current filters
            {filters.status ? ` (${filters.status.replace("_", " ").toLowerCase()})` : " — all statuses"}
          </p>
        </div>
      </header>

      <form className="glass-sm flex flex-wrap items-end gap-3 rounded-2xl p-4" method="GET">
        <label className="text-sm">
          <span className="text-muted-foreground">Search title</span>
          <Input
            type="search"
            name="q"
            defaultValue={current.q}
            maxLength={120}
            placeholder="e.g. Toyota Fielder"
            className="mt-1 w-56"
          />
        </label>
        <label className="text-sm">
          <span className="text-muted-foreground">Status</span>
          <select
            name="status"
            defaultValue={current.status}
            className="mt-1 block h-11 w-44 rounded-xl border border-border bg-background/60 px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {status.replace("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-muted-foreground">Category</span>
          <select
            name="category"
            defaultValue={current.category}
            className="mt-1 block h-11 w-44 rounded-xl border border-border bg-background/60 px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.slug}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-muted-foreground">Seller</span>
          <Input
            name="seller"
            defaultValue={current.seller}
            maxLength={120}
            placeholder="Business name"
            className="mt-1 w-44"
          />
        </label>
        <Button type="submit" size="sm">
          <Search className="h-4 w-4" aria-hidden />
          Apply
        </Button>
        {(current.q || current.status || current.category || current.seller) && (
          <Link
            href="/admin/listings"
            className="self-center text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            Clear filters
          </Link>
        )}
      </form>

      {listings.length === 0 ? (
        <EmptyState
          icon={Tags}
          title={total === 0 ? "No listings match." : "Nothing on this page."}
          description={
            total === 0
              ? "Sellers' products — in any state, including drafts and removed ones — appear here once they exist."
              : "Try the next page or relax the filters."
          }
        />
      ) : (
        <div className="glass flex flex-col divide-y divide-border rounded-2xl">
          {listings.map((listing) => (
            <Link
              key={listing.id}
              href={`/admin/listings/${listing.id}`}
              className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/40"
            >
              <span className="relative h-12 w-16 shrink-0 overflow-hidden rounded-lg bg-muted">
                {listing.images[0] ? (
                  <Image
                    src={listing.images[0].url}
                    alt=""
                    fill
                    sizes="64px"
                    className="object-cover"
                  />
                ) : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{listing.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {listing.seller.businessName}
                  <span className="mx-1" aria-hidden>
                    ·
                  </span>
                  {listing.category.name}
                  <span className="mx-1" aria-hidden>
                    ·
                  </span>
                  {listing.county}
                  <span className="ml-2 inline-flex items-center gap-1.5">
                    <SellerVerificationBadge status={listing.seller.verificationStatus} />
                  </span>
                </span>
              </span>
              <span className="hidden shrink-0 text-xs text-muted-foreground md:block">
                {listing._count.orderItems} sold-qty · {listing._count.wishlists} saved ·{" "}
                {listing._count.reports} report{listing._count.reports === 1 ? "" : "s"}
                <span className="block text-right">{timeAgo(listing.createdAt)}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-mono text-sm tabular-nums">
                  {formatKes(listing.priceCents)}
                </span>
                <span className="mt-1 block">
                  <ListingStatusBadge status={listing.status} />
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}

      <AdminPagination
        page={filters.page}
        pageSize={pageSize}
        total={total}
        label="listings"
        buildHref={(page) => adminListHref("/admin/listings", current, page)}
      />
    </Container>
  );
}
