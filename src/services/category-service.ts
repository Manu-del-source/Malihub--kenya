import "server-only";
import { prisma } from "@/lib/prisma";
import { DEFAULT_CATEGORIES } from "@/lib/constants";

export type CategoryWithCount = {
  name: string;
  slug: string;
  iconName: string;
  count: number;
};

const ICON_BY_SLUG: Map<string, string> = new Map(DEFAULT_CATEGORIES.map((c) => [c.slug, c.iconName] as [string, string]));

/**
 * Categories that actually have publicly visible listings, ordered by how
 * many listings they have (highest first, then alphabetically so ties are
 * stable). This is the same visibility rule the marketplace search applies:
 * ACTIVE products, verified seller or admin owner, and the categories the
 * search excludes stay excluded. Categories with zero listings never show
 * up - visitors only ever see doors that open onto real products.
 *
 * Data problems degrade to an empty list and callers fall back to the
 * static category list, so the page never breaks when the database is
 * unreachable.
 */
export async function getActiveCategoriesWithCounts(
  limit = 12
): Promise<CategoryWithCount[]> {
  try {
    const counts = await prisma.product.groupBy({
      by: ["categoryId"],
      where: {
        status: "ACTIVE",
        category: {
          isActive: true,
          slug: { notIn: ["vehicles", "property"] },
        },
        OR: [
          { seller: { verificationStatus: "VERIFIED" } },
          { owner: { role: { in: ["ADMIN", "SUPER_ADMIN"] } } },
        ],
      },
      _count: { _all: true },
    });
    if (counts.length === 0) return [];

    type CountRow = { categoryId: string; _count: { _all: number } };
    const typedCounts: CountRow[] = counts;

    const categories = await prisma.category.findMany({
      where: {
        id: { in: typedCounts.map((c: CountRow) => c.categoryId) },
        isActive: true,
      },
      select: { id: true, name: true, slug: true, iconName: true },
    });

    return categories
      .map(
        (
          category: { id: string; name: string; slug: string; iconName: string | null }
        ) => ({
          name: category.name,
          slug: category.slug,
          iconName:
            category.iconName ?? ICON_BY_SLUG.get(category.slug) ?? "Package",
          count:
            typedCounts.find(
              (c: CountRow) => c.categoryId === category.id
            )?._count._all ?? 0,
        })
      )
      .filter((c: CategoryWithCount) => c.count > 0)
      .sort(
        (a: CategoryWithCount, b: CategoryWithCount) =>
          b.count - a.count || a.name.localeCompare(b.name)
      )
      .slice(0, limit);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code ?? "unknown")
        : "unknown";
    console.error("Active-category count query failed; callers use fallback.", {
      code,
    });
    return [];
  }
}
