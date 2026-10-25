import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { HeroSection } from "@/components/storefront/hero-section";
import { CategoryRow } from "@/components/storefront/category-row";
import { FeatureCards } from "@/components/storefront/feature-cards";
import { ProductGrid } from "@/components/storefront/product-grid";
import { PromoBanner } from "@/components/storefront/promo-banner";
import { EditorialCards } from "@/components/storefront/editorial-cards";
import { TrustBar } from "@/components/storefront/trust-bar";
import { Newsletter } from "@/components/storefront/newsletter";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export const revalidate = 60;

export default async function HomePage() {
  const [categories, products] = await Promise.all([
    prisma.category.findMany({
      where: { isActive: true, parentId: null },
      orderBy: { sortOrder: "asc" },
      take: 6,
      select: { id: true, name: true, slug: true, iconName: true, imageUrl: true },
    }),
    prisma.product.findMany({
      where: { status: "ACTIVE", quantity: { gt: 0 } },
      orderBy: [{ isFeatured: "desc" }, { publishedAt: "desc" }],
      take: 8,
      select: {
        id: true, title: true, slug: true, priceCents: true, county: true,
        condition: true, isFeatured: true, publishedAt: true,
        images: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }], take: 1, select: { url: true } },
        category: { select: { name: true, slug: true } },
        seller: { select: { businessName: true, verificationStatus: true, ratingAverage: true, ratingCount: true } },
      },
    }),
  ]);

  const viewProducts = products.map((p) => ({
    id: p.id,
    title: p.title,
    slug: p.slug,
    priceCents: p.priceCents,
    county: p.county,
    condition: p.condition,
    imageUrl: p.images[0]?.url ?? null,
    categoryName: p.category.name,
    categorySlug: p.category.slug,
    sellerName: p.seller.businessName,
    sellerVerified: p.seller.verificationStatus === "VERIFIED",
    rating: Number(p.seller.ratingAverage),
    ratingCount: p.seller.ratingCount,
  }));

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-10 px-4 pb-12 pt-5 sm:gap-14 sm:px-6 lg:px-10">
        <HeroSection featuredImage={viewProducts[0]?.imageUrl ?? categories.find((c) => c.imageUrl)?.imageUrl ?? null} />
        <CategoryRow categories={categories} />
        <FeatureCards products={viewProducts.slice(0, 3)} />
        <ProductGrid products={viewProducts.slice(0, 4)} />
        <PromoBanner imageUrl={viewProducts.find((p) => p.imageUrl)?.imageUrl ?? null} />
        <EditorialCards />
        <TrustBar />
        <Newsletter />
      </div>
    </div>
  );
}
