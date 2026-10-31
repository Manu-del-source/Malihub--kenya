import Link from "next/link";
import { Suspense } from "react";
import { BadgeCheck, PackageSearch, Search, ShieldCheck, Truck, SlidersHorizontal } from "lucide-react";
import { SearchFiltersSidebar } from "@/components/marketplace/search-filters-sidebar";
import { SearchResultsGrid } from "@/components/marketplace/search-results-grid";
import { SortDropdownWrapper } from "@/components/marketplace/sort-dropdown-wrapper";
import { searchParamsSchema } from "@/lib/validations/listing";
import { searchListings } from "@/services/search-service";
import { toListingCardData } from "@/lib/mappers";
import { DEFAULT_CATEGORIES } from "@/lib/constants";
import { MarketplaceBackButton } from "@/components/marketplace/marketplace-back-button";

/**
 * Shared marketplace browser: database-backed catalogue with search,
 * category links, filters, sorting and cursor pagination.
 */
export async function MarketplaceBrowser({
  rawParams,
  heading,
  compact = false,
}: {
  rawParams: Record<string, string | string[] | undefined>;
  heading?: string;
  compact?: boolean;
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
    <div className="mx-auto max-w-[1440px] min-w-0 text-foreground">
      {!compact && <MarketplaceBackButton />}
      {!compact && <section className="mb-4 overflow-hidden rounded-xl border border-foreground/10 bg-card shadow-2xl shadow-black/20 sm:mb-6 sm:rounded-2xl">
        <div className="bg-[radial-gradient(ellipse_at_top_right,rgba(201,151,70,0.16),transparent_55%),linear-gradient(135deg,hsl(var(--card)),hsl(var(--background)))] px-4 py-5 sm:p-8 lg:p-10">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold text-amber-300 sm:mb-3 sm:px-3 sm:text-xs">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            MaliHub Marketplace
          </div>
          <h1 className="max-w-2xl font-display text-xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {heading ?? (flatParams.q ? `Results for “${flatParams.q}”` : "Find your next great deal")}
          </h1>
          <p className="mt-1.5 max-w-xl text-xs leading-5 text-muted-foreground sm:mt-2 sm:text-base sm:leading-6">
            Discover products from sellers across Kenya. Compare prices and shop with confidence.
          </p>
          <div className="mt-3 hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
            <ShieldCheck className="h-4 w-4 text-amber-300" aria-hidden />
            Seller details on every listing
          </div>
        </div>
        <form action="/marketplace" method="get" role="search" className="border-t border-foreground/10 bg-card p-3 sm:p-4">
          <div className="flex gap-2">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Search products</span>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                type="search"
                name="q"
                defaultValue={typeof flatParams.q === "string" ? flatParams.q : ""}
                placeholder="Search products, brands and more..."
                className="h-11 w-full rounded-lg border border-foreground/10 bg-background pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-400/15 sm:h-12 sm:rounded-xl sm:pl-11 sm:pr-4"
              />
            </label>
            <button type="submit" className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-amber-400 px-3.5 text-sm font-semibold text-primary-foreground transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-12 sm:rounded-xl sm:px-6">
              <Search className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Search</span>
            </button>
          </div>
        </form>
      </section>}

      {!compact && <nav aria-label="Browse categories" className="mb-5 sm:mb-7">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Categories</h2>
          <span className="hidden text-xs text-muted-foreground sm:inline">Shop by category</span>
        </div>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {DEFAULT_CATEGORIES.slice(0, 10).map((category) => {
            const selected = activeCategory === category.slug;
            return (
              <Link
                key={category.slug}
                href={selected ? "/marketplace" : `/marketplace?category=${encodeURIComponent(category.slug)}`}
                aria-current={selected ? "page" : undefined}
                className={`shrink-0 rounded-full border px-3 py-2 text-xs font-medium transition sm:px-4 sm:py-2.5 sm:text-sm ${selected ? "border-amber-400 bg-amber-400 text-primary-foreground" : "border-foreground/10 bg-card text-foreground/80 hover:border-amber-400/50 hover:bg-amber-400/5"}`}
              >
                {category.name}
              </Link>
            );
          })}
        </div>
      </nav>}

      <div className="mb-4 flex items-end justify-between gap-3 border-b border-foreground/10 pb-3 sm:mb-5 sm:pb-4">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold tracking-tight sm:text-2xl">
            {heading ?? (flatParams.q ? "Search results" : activeCategory ? "Explore this category" : "Browse all listings")}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            {result.items.length > 0 ? "Fresh finds from sellers around Kenya" : "No listings found for these filters"}
          </p>
        </div>
        <div className="hidden items-center gap-2 text-xs text-muted-foreground xl:flex">
          <PackageSearch className="h-4 w-4" aria-hidden />
          Filter by location, condition and price
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:gap-7">
        {!compact && <div className="lg:hidden">
          <details className="group rounded-xl border border-foreground/10 bg-card">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
              <span className="inline-flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-primary" aria-hidden /> Filters &amp; refine</span>
              <span className="text-xs text-muted-foreground group-open:hidden">Tap to open</span>
              <span className="hidden text-xs text-muted-foreground group-open:inline">Tap to close</span>
            </summary>
            <div className="border-t border-foreground/10 p-2">
              <Suspense fallback={null}><SearchFiltersSidebar /></Suspense>
            </div>
          </details>
        </div>}
        {!compact && <aside className="hidden lg:block lg:w-64 lg:shrink-0 lg:self-start">
          <Suspense fallback={null}><SearchFiltersSidebar /></Suspense>
        </aside>}
        <div className="min-w-0 flex-1">
          <div className="mb-3 flex items-center justify-between gap-2 sm:mb-4">
            <p className="text-xs text-muted-foreground sm:text-sm">
              <span className="font-semibold text-foreground">{result.items.length}</span> listings on this page
            </p>
            <Suspense fallback={null}><SortDropdownWrapper currentSort={params.sort} /></Suspense>
          </div>
          <SearchResultsGrid
            searchParamsString={clientParamsString}
            initialItems={initialItems}
            initialNextCursor={result.nextCursor}
            initialHasMore={result.hasMore}
          />
        </div>
      </div>

      {!compact && <div className="mt-8 hidden grid-cols-3 gap-3 rounded-2xl border border-foreground/10 bg-card p-4 sm:grid sm:p-5 lg:mt-10">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300"><BadgeCheck className="h-5 w-5" aria-hidden /></div>
          <div><p className="text-sm font-semibold text-foreground">Verified sellers</p><p className="text-xs text-muted-foreground">Look for seller verification</p></div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Truck className="h-5 w-5" aria-hidden /></div>
          <div><p className="text-sm font-semibold text-foreground">Shop across Kenya</p><p className="text-xs text-muted-foreground">Browse listings by county</p></div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><ShieldCheck className="h-5 w-5" aria-hidden /></div>
          <div><p className="text-sm font-semibold text-foreground">Know the seller</p><p className="text-xs text-muted-foreground">Review seller information</p></div>
        </div>
      </div>}
    </div>
  );
}
