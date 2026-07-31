import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { Plus, Package, Eye, Heart } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { ListingStatusBadge } from "@/components/dashboard/seller/listing-status-badge";
import { ListingRowActions } from "@/components/dashboard/seller/listing-row-actions";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { formatKes, timeAgo } from "@/utils";

export const metadata: Metadata = { title: "My listings" };

const LISTING_ROW_INCLUDE = {
  images: { orderBy: { sortOrder: "asc" as const }, take: 1 },
} satisfies Prisma.ProductInclude;

type ListingRow = Prisma.ProductGetPayload<{ include: typeof LISTING_ROW_INCLUDE }>;

export default async function SellerListingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const seller = await prisma.seller.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!seller) redirect("/dashboard/buyer");

  const listings = await prisma.product.findMany({
    where: { sellerId: seller.id, status: { not: "REMOVED" } },
    include: LISTING_ROW_INCLUDE,
    orderBy: { updatedAt: "desc" },
  });

  return (
    <Container className="py-12">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-medium">My listings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {listings.length} listing{listings.length === 1 ? "" : "s"}
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/seller/listings/new">
            <Plus className="h-4 w-4" aria-hidden />
            New listing
          </Link>
        </Button>
      </div>

      {listings.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No listings yet"
          description="Create your first listing to start selling on MaliHub."
          actionLabel="Create a listing"
          actionHref="/dashboard/seller/listings/new"
        />
      ) : (
        <div className="glass overflow-hidden rounded-2xl">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
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
                <tr key={listing.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                        {listing.images[0] && (
                          <Image src={listing.images[0].url} alt="" fill sizes="48px" className="object-cover" />
                        )}
                      </div>
                      <span className="line-clamp-1 font-medium text-foreground/90">{listing.title}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <ListingStatusBadge status={listing.status} />
                  </td>
                  <td className="px-5 py-3 font-mono tabular-nums">{formatKes(listing.priceCents)}</td>
                  <td className="px-5 py-3 text-muted-foreground">{listing.viewCount}</td>
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
