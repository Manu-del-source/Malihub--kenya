export type PublicListingInput = {
  id: string; title: string; slug: string; description: string; priceCents: number;
  isNegotiable: boolean; condition: string; brand: string | null; quantity: number;
  county: string; subCounty: string | null; status: string; isFeatured: boolean;
  publishedAt: Date | null;
  images: Array<{ id: string; url: string; sortOrder: number; isPrimary: boolean }>;
  category: { id: string; name: string; slug: string; iconName: string | null; imageUrl: string | null };
  seller: { businessName: string; slug: string; logoUrl: string | null; verificationStatus: string; ratingAverage: unknown; county: string };
};

/** Public catalog shape. Internal ownership and supplier linkage stay server-side. */
export function toPublicListing(product: PublicListingInput) {
  return {
    id: product.id,
    title: product.title,
    slug: product.slug,
    description: product.description,
    priceCents: product.priceCents,
    isNegotiable: product.isNegotiable,
    condition: product.condition,
    brand: product.brand,
    quantity: product.quantity,
    county: product.county,
    subCounty: product.subCounty,
    status: product.status,
    isFeatured: product.isFeatured,
    publishedAt: product.publishedAt,
    images: product.images.map((image) => ({
      id: image.id,
      url: image.url,
      sortOrder: image.sortOrder,
      isPrimary: image.isPrimary,
    })),
    category: {
      id: product.category.id,
      name: product.category.name,
      slug: product.category.slug,
      iconName: product.category.iconName,
      imageUrl: product.category.imageUrl,
    },
    seller: {
      businessName: product.seller.businessName,
      slug: product.seller.slug,
      logoUrl: product.seller.logoUrl,
      verificationStatus: product.seller.verificationStatus,
      ratingAverage: product.seller.ratingAverage,
      county: product.seller.county,
    },
  };
}

export function toPublicListingPage<T extends { items: PublicListingInput[] }>(page: T) {
  return { ...page, items: page.items.map(toPublicListing) };
}
