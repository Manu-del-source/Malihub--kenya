import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { SearchFiltersSidebar } from "@/components/marketplace/search-filters-sidebar";
import { SearchResultsGrid } from "@/components/marketplace/search-results-grid";
import { SortDropdownWrapper } from "@/components/marketplace/sort-dropdown-wrapper";
import { searchParamsSchema } from "@/lib/validations/listing";
import { searchListings } from "@/services/search-service";
import { getActiveCategoryOptions } from "@/services/category-service";
import { toListingCardData } from "@/lib/mappers";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { prisma } from "@/lib/prisma";

type CategoryPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  if (slug === "vehicles" || slug === "property") return { robots: { index: false, follow: false } };
  const category = await prisma.category.findUnique({ where: { slug }, select: { name: true } });
  if (!category) return {};

  return {
    title: category.name,
    description: `Browse ${category.name} listings across all 47 Kenyan counties on MaliHub.`,
    alternates: { canonical: `/categories/${slug}` },
  };
}

export default async function CategoryPage({ params, searchParams }: CategoryPageProps) {
  const { slug } = await params;
  if (slug === "vehicles" || slug === "property") notFound();
  const category = await prisma.category.findUnique({
    where: { slug, isActive: true },
    include: {
      parent: { select: { name: true, slug: true } },
      children: {
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, slug: true },
      },
    },
  });
  if (!category) notFound();

  const rawParams = await searchParams;
  const flatParams = Object.fromEntries(
    Object.entries(rawParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])
  );

  const parsed = searchParamsSchema.safeParse({ ...flatParams, category: slug });
  const searchInput = parsed.success ? parsed.data : { sort: "newest" as const, category: slug };

  const [result, categoryOptions] = await Promise.all([
    searchListings(searchInput),
    getActiveCategoryOptions(),
  ]);
  const initialItems = result.items.map((item) => toListingCardData(item));

  const clientParamsString = new URLSearchParams({
    ...Object.fromEntries(Object.entries(flatParams).filter(([k, v]) => !!v && k !== "cursor")),
    category: slug,
  } as Record<string, string>).toString();

  return (
    <Container className="py-10">
      {category.parent && (
        <Link href={`/categories/${encodeURIComponent(category.parent.slug)}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-amber-400">
          <ChevronRight className="h-4 w-4 rotate-180" aria-hidden />
          {category.parent.name}
        </Link>
      )}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-medium sm:text-3xl">{category.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {result.items.length > 0 ? "Showing active listings" : "No listings found in this category yet"}
          </p>
        </div>
        <Suspense fallback={null}>
          <SortDropdownWrapper currentSort={searchInput.sort} />
        </Suspense>
      </div>

      {category.children.length > 0 && (
        <nav aria-label={`${category.name} subcategories`} className="mb-7 overflow-hidden rounded-xl border border-foreground/10 bg-card">
          <h2 className="border-b border-foreground/10 px-4 py-3 text-sm font-semibold">Shop by subcategory</h2>
          <div className="divide-y divide-foreground/10">
            {category.children.map((child) => (
              <Link key={child.id} href={`/categories/${encodeURIComponent(child.slug)}`} className="flex min-h-12 items-center justify-between gap-3 px-4 py-3 text-sm transition hover:bg-amber-400/5 hover:text-amber-400">
                <span>{child.name}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
              </Link>
            ))}
          </div>
        </nav>
      )}

      <div className="flex flex-col gap-8 lg:flex-row">
        <Suspense fallback={null}>
          <SearchFiltersSidebar categories={categoryOptions} />
        </Suspense>
        <div className="flex-1">
          <SearchResultsGrid
            searchParamsString={clientParamsString}
            initialItems={initialItems}
            initialNextCursor={result.nextCursor}
            initialHasMore={result.hasMore}
          />
        </div>
      </div>
    </Container>
  );
}
