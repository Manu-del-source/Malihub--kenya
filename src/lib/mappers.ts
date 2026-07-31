import type { ListingCardData } from "@/components/marketplace/listing-card";
import type { ProductWithRelations } from "@/types";

export function toListingCardData(
  product: ProductWithRelations,
  favoritedProductIds?: Set<string>
): ListingCardData {
  return {
    id: product.id,
    slug: product.slug,
    title: product.title,
    priceCents: product.priceCents,
    isNegotiable: product.isNegotiable,
    imageUrl: product.images[0]?.url ?? "",
    county: product.county,
    postedAt: (product.publishedAt ?? product.createdAt).toISOString(),
    isVerifiedSeller: product.seller.verificationStatus === "VERIFIED",
    sellerName: product.seller.businessName,
    favoriteCount: product.favoriteCount,
    condition: product.condition,
    isFavorited: favoritedProductIds?.has(product.id) ?? false,
  };
}
