import { Suspense } from "react";
import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { SearchFiltersSidebar } from "@/components/marketplace/search-filters-sidebar";
import { SearchResultsGrid } from "@/components/marketplace/search-results-grid";
import { SortDropdownWrapper } from "@/components/marketplace/sort-dropdown-wrapper";
import { searchParamsSchema } from "@/lib/validations/listing";
import { searchListings } from "@/services/search-service";
import { toListingCardData } from "@/lib/mappers";

export const metadata: Metadata = {
  title: "Browse listings",
  description: "Search and filter listings across all 47 Kenyan counties.",
};

type SearchPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const rawParams = await searchParams;
  const flatParams = Object.fromEntries(
    Object.entries(rawParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])
  );

  const parsed = searchParamsSchema.safeParse(flatParams);
  const params = parsed.success ? parsed.data : { sort: "newest" as const };

  const result = await searchListings(params);
  const initialItems = result.items.map((item) => toListingCardData(item));

  const clientParamsString = new URLSearchParams(
    Object.entries(flatParams).filter(([k, v]) => !!v && k !== "cursor") as [string, string][]
  ).toString();

  return (
    <Container className="py-10">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-medium sm:text-3xl">
            {flatParams.q ? `Results for "${flatParams.q}"` : "Browse all listings"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {result.items.length > 0 ? "Showing active listings" : "No listings found"}
          </p>
        </div>
        <Suspense fallback={null}>
          <SortDropdownWrapper currentSort={params.sort} />
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
