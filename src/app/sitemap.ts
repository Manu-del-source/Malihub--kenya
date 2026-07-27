import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://malihub.co.ke";

/**
 * Generated at request time on ISR (see `revalidate` below) rather than at
 * build time, so newly published listings show up in the sitemap without a
 * full redeploy.
 */
export const revalidate = 3600; // 1 hour

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: BASE_URL, changeFrequency: "daily", priority: 1 },
    { url: `${BASE_URL}/search`, changeFrequency: "daily", priority: 0.8 },
    { url: `${BASE_URL}/login`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE_URL}/register`, changeFrequency: "yearly", priority: 0.3 },
  ];

  const [categories, products] = await Promise.all([
    prisma.category.findMany({
      where: { isActive: true },
      select: { slug: true },
    }),
    prisma.product.findMany({
      where: { status: "ACTIVE" },
      select: { slug: true, updatedAt: true },
      take: 50000, // Sitemap protocol cap is 50k URLs per file
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const categoryRoutes: MetadataRoute.Sitemap = categories.map((c: { slug: string }) => ({
    url: `${BASE_URL}/categories/${c.slug}`,
    changeFrequency: "daily",
    priority: 0.7,
  }));

  const productRoutes: MetadataRoute.Sitemap = products.map(
    (p: { slug: string; updatedAt: Date }) => ({
      url: `${BASE_URL}/products/${p.slug}`,
      lastModified: p.updatedAt,
      changeFrequency: "weekly",
      priority: 0.6,
    })
  );

  return [...staticRoutes, ...categoryRoutes, ...productRoutes];
}
