import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, BadgeCheck, PackageSearch, Search, ShieldCheck, Truck } from "lucide-react";
import { SearchFiltersSidebar } from "@/components/marketplace/search-filters-sidebar";
import { SearchResultsGrid } from "@/components/marketplace/search-results-grid";
import { SortDropdownWrapper } from "@/components/marketplace/sort-dropdown-wrapper";
import { searchParamsSchema } from "@/lib/validations/listing";
import { searchListings } from "@/services/search-service";
import { toListingCardData } from "@/lib/mappers";
import { DEFAULT_CATEGORIES } from "@/lib/constants";

/**
 * Shared marketplace browser: a real database-backed catalogue with search,
 * category links, filters, sorting and cursor pagination. Keep the page
 * focused on shopping rather than marketing/landing-page content.
 */
export async function MarketplaceBrowser({
  rawParams,
  heading,
}: {
  rawParams: Record<string, string | string[] | undefined>;
  heading?: string;
}) {
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

  const activeCategory = flatParams.category;

  return (
    <div className="mx-auto max-w-[1440px]">
      <div className="mb-6 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="grid gap-5 bg-gradient-to-br from-card via-card to-primary/10 p-5 sm:p-7 lg:grid-cols-[1fr_auto] lg:items-center lg:p-8">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              MaliHub Marketplace
            </div>
            <h1 className="max-w-2xl font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              {heading ?? (flatParams.q ? `Results for “${flatParams.q}”` : "Find your next great deal")}
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
              Discover products from sellers across Kenya. Compare prices, check seller details and shop with confidence.
            </p>
          </div>
          <div className="hidden items-center gap-3 rounded-xl border border-border/70 bg-background/70 p-4 lg:flex">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ShieldCheck className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-semibold">Shop with confidence</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Seller details on every listing</p>
            </div>
          </div>
        </div>

        <form action="/marketplace" method="get" className="border-t border-border p-3 sm:p-4">
          <div className="flex gap-2">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Search products</span>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                type="search"
                name="q"
                defaultValue={typeof flatParams.q === "string" ? flatParams.q : ""}
                placeholder="Search products, brands and more..."
                className="h-12 w-full rounded-xl border border-border bg-background pl-10 pr-4 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
            </label>
            <button type="submit" className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-6">
              <Search className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Search</span>
            </button>
          </div>
        </form>
      </div>

      <nav aria-label="Browse categories" className="mb-7">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Explore categories</h2>
          <span className="text-xs text-muted-foreground">Shop by category</span>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {DEFAULT_CATEGORIES.slice(0, 10).map((category) => {
            const selected = activeCategory === category.slug;
            return (
              <Link
                key={category.slug}
                href={selected ? "/marketplace" : `/marketplace?category=${encodeURIComponent(category.slug)}`}
                aria-current={selected ? "page" : undefined}
                className={`shrink-0 rounded-full border px-4 py-2.5 text-sm font-medium transition ${selected ? "border-primary bg-primary text-primary-foreground shadow-sm" : "border-border bg-card text-foreground hover:border-primary/50 hover:bg-primary/5"}`}
              >
                {category.name}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">The catalogue</p>
          <h2 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
            {flatParams.q ? "Search results" : activeCategory ? "Explore this category" : "Browse all listings"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {result.items.length > 0 ? "Fresh finds from sellers around Kenya" : "No listings found for these filters"}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <PackageSearch className="h-4 w-4" aria-hidden />
          <span>Filter by location, condition and price</span>
        </div>
      </div>

      <div className="flex flex-col gap-5 lg:flex-row lg:gap-7">
        <div className="rounded-2xl border border-border bg-card p-4 lg:w-64 lg:shrink-0 lg:self-start lg:p-5">
          <Suspense fallback={null}>
            <SearchFiltersSidebar />
          </Suspense>
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{result.items.length}</span> listings on this page
            </p>
            <Suspense fallback={null}>
              <SortDropdownWrapper currentSort={params.sort} />
            </Suspense>
          </div>
          <SearchResultsGrid
            searchParamsString={clientParamsString}
            initialItems={initialItems}
            initialNextCursor={result.nextCursor}
            initialHasMore={result.hasMore}
          />
        </div>
      </div>

      <div className="mt-10 grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-3 sm:p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><BadgeCheck className="h-5 w-5" aria-hidden /></div>
          <div><p className="text-sm font-semibold">Verified sellers</p><p className="text-xs text-muted-foreground">Look for seller verification</p></div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Truck className="h-5 w-5" aria-hidden /></div>
          <div><p className="text-sm font-semibold">Shop across Kenya</p><p className="text-xs text-muted-foreground">Browse listings by county</p></div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><ShieldCheck className="h-5 w-5" aria-hidden /></div>
          <div><p className="text-sm font-semibold">Know the seller</p><p className="text-xs text-muted-foreground">Review listing and seller information</p></div>
        </div>
      </div>
    </div>
  );
}
