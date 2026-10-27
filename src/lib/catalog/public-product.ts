import "server-only";

import type { Prisma } from "@prisma/client";
import type { ProductWithRelations } from "@/types";

/** Fields intentionally visible to marketplace visitors. Never include the
 * owner, supplier linkage, supplier costs, or image storage identifiers. */
export const PUBLIC_PRODUCT_SELECT = {
  id: true,
  slug: true,
  title: true,
  description: true,
  priceCents: true,
  isNegotiable: true,
  condition: true,
  brand: true,
  quantity: true,
  contactPreference: true,
  county: true,
  subCounty: true,
  status: true,
  favoriteCount: true,
  images: { orderBy: { sortOrder: "asc" }, select: { url: true } },
  category: { select: { id: true, name: true, slug: true } },
  seller: {
    select: {
      businessName: true,
      slug: true,
      logoUrl: true,
      verificationStatus: true,
      ratingAverage: true,
      ratingCount: true,
      county: true,
    },
  },
} satisfies Prisma.ProductSelect;

export type PublicProductRow = Prisma.ProductGetPayload<{ select: typeof PUBLIC_PRODUCT_SELECT }>;

/** Construct the wire shape explicitly, including every nested relation. */
export function toPublicProduct(product: PublicProductRow): ProductWithRelations {
  return {
    id: product.id,
    slug: product.slug,
    title: product.title,
    description: product.description,
    priceCents: product.priceCents,
    isNegotiable: product.isNegotiable,
    condition: product.condition,
    brand: product.brand,
    quantity: product.quantity,
    contactPreference: product.contactPreference,
    county: product.county,
    subCounty: product.subCounty,
    status: product.status,
    favoriteCount: product.favoriteCount,
    images: product.images.map((image) => ({ url: image.url })),
    category: {
      id: product.category.id,
      name: product.category.name,
      slug: product.category.slug,
    },
    seller: {
      businessName: product.seller.businessName,
      slug: product.seller.slug,
      logoUrl: product.seller.logoUrl,
      verificationStatus: product.seller.verificationStatus,
      ratingAverage: Number(product.seller.ratingAverage),
      ratingCount: product.seller.ratingCount,
      county: product.seller.county,
    },
  };
}
