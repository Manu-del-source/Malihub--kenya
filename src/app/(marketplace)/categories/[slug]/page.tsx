import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { SearchFiltersSidebar } from "@/components/marketplace/search-filters-sidebar";
import { SearchResultsGrid } from "@/components/marketplace/search-results-grid";
import { SortDropdownWrapper } from "@/components/marketplace/sort-dropdown-wrapper";
import { searchParamsSchema } from "@/lib/validations/listing";
import { searchListings } from "@/services/search-service";
import { toListingCardData } from "@/lib/mappers";
import { prisma } from "@/lib/prisma";

type CategoryPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
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
  const category = await prisma.category.findUnique({ where: { slug, isActive: true } });
  if (!category) notFound();

  const rawParams = await searchParams;
  const flatParams = Object.fromEntries(
    Object.entries(rawParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])
  );

  const parsed = searchParamsSchema.safeParse({ ...flatParams, category: slug });
  const searchInput = parsed.success ? parsed.data : { sort: "newest" as const, category: slug };

  const result = await searchListings(searchInput);
  const initialItems = result.items.map((item) => toListingCardData(item));

  const clientParamsString = new URLSearchParams({
    ...Object.fromEntries(Object.entries(flatParams).filter(([k, v]) => !!v && k !== "cursor")),
    category: slug,
  } as Record<string, string>).toString();

  return (
    <Container className="py-10">
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

      <div className="flex flex-col gap-8 lg:flex-row">
        <Suspense fallback={null}>
          <SearchFiltersSidebar />
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
