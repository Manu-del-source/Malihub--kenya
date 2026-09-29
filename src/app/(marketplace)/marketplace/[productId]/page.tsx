import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ProductDetail } from "@/components/marketplace/product-detail";
import { getCurrentUser } from "@/lib/auth";
import { canViewListing } from "@/lib/listing-visibility";
import { getListingById } from "@/services/search-service";

/**
 * Canonical product-detail route, addressed by the listing's id.
 *
 * `/products/[slug]` remains fully supported (notifications, sitemaps and
 * shared links keep resolving there); both routes render the SAME
 * ProductDetail view, so there is one detail implementation in the codebase.
 *
 * Rendered per request — never prerendered: this route reads the session
 * (same reasoning as every session-reading route: docs/auth/ARCHITECTURE.md §6).
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ productId: string }>;
}): Promise<Metadata> {
  const { productId } = await params;
  const product = await getListingById(productId);
  if (!product || (product.status !== "ACTIVE" && product.status !== "SOLD")) return {};

  return {
    title: product.title,
    description: product.description.slice(0, 160),
    openGraph: {
      title: product.title,
      description: product.description.slice(0, 160),
      images: product.images[0] ? [product.images[0].url] : [],
    },
  };
}

export default async function MarketplaceProductPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const product = await getListingById(productId);
  if (!product) notFound();

  // Same rule as GET /api/products/[id]: ACTIVE/SOLD are public; anything
  // else renders only for its owner or an administrator (shared helper so
  // the page and the API can't drift). Everyone else gets the same 404 an
  // unknown id would, so unpublished listings can't be probed.
  if (!canViewListing(product, (await getCurrentUser())?.user)) {
    notFound();
  }

  return (
    <ProductDetail product={product} canonicalPath={`/marketplace/${product.id}`} />
  );
}
