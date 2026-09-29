import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ProductDetail } from "@/components/marketplace/product-detail";
import { getCurrentUser } from "@/lib/auth";
import { canViewListing } from "@/lib/listing-visibility";
import { getListingBySlug } from "@/services/search-service";

/**
 * Rendered per request — never prerendered: this route reads the session.
 *
 * Required because reading a Neon Auth session does not necessarily touch a
 * cookie (an unconfigured environment short-circuits first), so Next.js would
 * otherwise prerender this page as a static redirect to /login. The full
 * reasoning is in the layout banners and docs/auth/ARCHITECTURE.md §6.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getListingBySlug(slug);
  if (!product) return {};

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

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await getListingBySlug(slug);
  if (!product) notFound();

  // Identical visibility rule to the id-form route and the API — see
  // src/lib/listing-visibility.ts.
  if (!canViewListing(product, (await getCurrentUser())?.user)) {
    notFound();
  }

  return <ProductDetail product={product} canonicalPath={`/products/${product.slug}`} />;
}
