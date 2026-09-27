import type { Metadata } from "next";
import { Heart } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/shared/empty-state";
import { ListingCard, type ListingCardData } from "@/components/marketplace/listing-card";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Rendered per request — never prerendered: this route reads the session.
 *
 * Required because reading a Neon Auth session does not necessarily touch a
 * cookie (an unconfigured environment short-circuits first), so Next.js would
 * otherwise prerender this page as a static redirect to /login. The full
 * reasoning is in the layout banners and docs/auth/ARCHITECTURE.md §6.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Your favorites" };

const FAVORITE_INCLUDE = {
  product: {
    include: {
      images: { orderBy: { sortOrder: "asc" as const }, take: 1 },
      seller: { select: { businessName: true, verificationStatus: true } },
    },
  },
} satisfies Prisma.WishlistInclude;

type FavoriteWithProduct = Prisma.WishlistGetPayload<{ include: typeof FAVORITE_INCLUDE }>;

export default async function FavoritesPage() {
  const { user } = await requireUser();

  const favorites = await prisma.wishlist.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: FAVORITE_INCLUDE,
  });

  const listings: ListingCardData[] = favorites
    .filter((f: FavoriteWithProduct) => f.product.status === "ACTIVE")
    .map((f: FavoriteWithProduct) => ({
      id: f.product.id,
      slug: f.product.slug,
      title: f.product.title,
      priceCents: f.product.priceCents,
      isNegotiable: f.product.isNegotiable,
      imageUrl: f.product.images[0]?.url ?? "",
      county: f.product.county,
      postedAt: (f.product.publishedAt ?? f.product.createdAt).toISOString(),
      isVerifiedSeller: f.product.seller.verificationStatus === "VERIFIED",
      sellerName: f.product.seller.businessName,
      favoriteCount: f.product.favoriteCount,
      condition: f.product.condition,
    }));

  return (
    <Container className="py-12">
      <h1 className="mb-1 font-display text-3xl font-medium">Your favorites</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        {listings.length} saved listing{listings.length === 1 ? "" : "s"}
      </p>

      {listings.length === 0 ? (
        <EmptyState
          icon={Heart}
          title="No favorites yet"
          description="Tap the heart on any listing to save it here for later."
          actionLabel="Explore listings"
          actionHref="/search"
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {listings.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}
    </Container>
  );
}
