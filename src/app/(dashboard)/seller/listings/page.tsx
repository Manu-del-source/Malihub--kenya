import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { Plus, Package, Eye, Heart } from "lucide-react";
import { Container } from "@/components/ui/container";
import { ListingStatusBadge } from "@/components/shell/seller/listing-status-badge";
import { ListingRowActions } from "@/components/shell/seller/listing-row-actions";
import { requireSellerAccess } from "@/lib/auth";
import { BUYER_DASHBOARD_PATH, SELLER_DASHBOARD_PATH } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { formatKes, timeAgo } from "@/utils";

/**
 * Rendered per request — never prerendered: this route reads the session.
 *
 * Required because reading a Neon Auth session does not necessarily touch a
 * cookie (an unconfigured environment short-circuits first), so Next.js would
 * otherwise prerender this page as a static redirect to /login. The full
 * reasoning is in the layout banners and docs/auth/ARCHITECTURE.md §6.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "My listings" };

const LISTING_ROW_INCLUDE = {
  images: { orderBy: { sortOrder: "asc" as const }, take: 1 },
} satisfies Prisma.ProductInclude;

type ListingRow = Prisma.ProductGetPayload<{ include: typeof LISTING_ROW_INCLUDE }>;

export default async function SellerListingsPage() {
  // Seller access is decided by the `sellers` row, not by `role === "SELLER"`:
  // every role can still buy, and a SELLER-role account whose row was never
  // created must not be shown an empty seller dashboard. Administrators are
  // allowed through for support, so the row lookup below still guards the
  // seller-specific query.
  const { user } = await requireSellerAccess();

  const seller = await prisma.seller.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!seller) redirect(BUYER_DASHBOARD_PATH);

  const listings = await prisma.product.findMany({
    where: { sellerId: seller.id, status: { not: "REMOVED" } },
    include: LISTING_ROW_INCLUDE,
    orderBy: { updatedAt: "desc" },
  });

  return (
    <Container className="min-h-[calc(100svh-180px)] py-10 text-white sm:py-12">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-medium">My listings</h1>
          <p className="mt-1 text-sm text-white/60">
            {listings.length} listing{listings.length === 1 ? "" : "s"}
          </p>
        </div>
        <Link
          href={`${SELLER_DASHBOARD_PATH}/listings/new`}
          className="inline-flex items-center gap-2 rounded-full bg-[#FF8C42] px-5 py-2 text-sm font-bold text-black transition hover:bg-[#ff9b5c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF8C42]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0A0A]"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add new listing
        </Link>
      </div>

      {listings.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-[#141414] py-20 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-[#FF8C42]">
            <Package className="h-6 w-6" aria-hidden />
          </div>
          <h2 className="mt-5 text-lg font-semibold text-white">Add your first product</h2>
          <p className="mx-auto mt-2 max-w-md px-5 text-sm leading-6 text-white/60">
            Create your first listing to start selling on MaliHub.
          </p>
          <Link
            href={`${SELLER_DASHBOARD_PATH}/listings/new`}
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#FF8C42] px-5 py-2.5 text-sm font-bold text-black transition hover:bg-[#ff9b5c]"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add new listing
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#141414]">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-white/10 text-xs uppercase tracking-wide text-white/50">
              <tr>
                <th className="px-5 py-3 font-medium">Listing</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Price</th>
                <th className="px-5 py-3 font-medium">
                  <Eye className="h-3.5 w-3.5" aria-hidden />
                </th>
                <th className="px-5 py-3 font-medium">
                  <Heart className="h-3.5 w-3.5" aria-hidden />
                </th>
                <th className="px-5 py-3 font-medium">Updated</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {listings.map((listing: ListingRow) => (
                <tr key={listing.id} className="border-b border-white/10 last:border-0 hover:bg-white/[0.03]">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-[#1A1A1A]">
                        {listing.images[0] && (
                          <Image src={listing.images[0].url} alt="" fill sizes="48px" className="object-cover" />
                        )}
                      </div>
                      <span className="line-clamp-1 font-medium text-white">{listing.title}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <ListingStatusBadge status={listing.status} />
                  </td>
                  <td className="px-5 py-3 font-mono tabular-nums text-white/90">{formatKes(listing.priceCents)}</td>
                  <td className="px-5 py-3 text-white/60">{listing.viewCount}</td>
                  <td className="px-5 py-3 text-muted-foreground">{listing.favoriteCount}</td>
                  <td className="px-5 py-3 text-muted-foreground">{timeAgo(listing.updatedAt)}</td>
                  <td className="px-5 py-3 text-right">
                    <ListingRowActions productId={listing.id} status={listing.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Container>
  );
}
