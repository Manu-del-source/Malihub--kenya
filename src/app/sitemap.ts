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

  // The dynamic half of the sitemap needs the database, but this route is
  // **prerendered** (ISR), so those queries run during `next build` — which
  // made the whole deployment depend on the build machine being able to reach
  // Postgres. A database that is unreachable from CI, or not yet migrated,
  // would fail the build at "Generating static pages" and take the entire
  // deploy down with it. Degrade to the static routes instead: they are still
  // a valid sitemap, the next ISR revalidation (1h) regenerates the full one
  // once the database answers, and the failure is logged rather than swallowed.
  let categories: { slug: string }[] = [];
  let products: { slug: string; updatedAt: Date }[] = [];
  try {
    [categories, products] = await Promise.all([
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
  } catch (error) {
    console.error("[sitemap] database unavailable — serving static routes only:", error);
  }

  const categoryRoutes: MetadataRoute.Sitemap = categories.map((c) => ({
    url: `${BASE_URL}/categories/${c.slug}`,
    changeFrequency: "daily",
    priority: 0.7,
  }));

  const productRoutes: MetadataRoute.Sitemap = products.map(
    (p) => ({
      url: `${BASE_URL}/products/${p.slug}`,
      lastModified: p.updatedAt,
      changeFrequency: "weekly",
      priority: 0.6,
    })
  );

  return [...staticRoutes, ...categoryRoutes, ...productRoutes];
}
