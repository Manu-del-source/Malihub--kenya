import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Heart } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/shared/empty-state";
import { ListingCard, type ListingCardData } from "@/components/marketplace/listing-card";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

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
