"use client";

import { useEffect, useRef } from "react";
import { Loader2, SearchX } from "lucide-react";
import { ListingCard, type ListingCardData } from "@/components/marketplace/listing-card";
import { ListingGridSkeleton } from "@/components/marketplace/listing-skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { useSearchListings } from "@/hooks/use-search-listings";

export function SearchResultsGrid({
  searchParamsString,
  initialItems,
  initialNextCursor,
  initialHasMore,
}: {
  searchParamsString: string;
  initialItems: ListingCardData[];
  initialNextCursor: string | null;
  initialHasMore: boolean;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useSearchListings(
    searchParamsString,
    { items: initialItems, nextCursor: initialNextCursor, hasMore: initialHasMore }
  );

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: "400px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const pages = data?.pages ?? [
    { items: initialItems, nextCursor: initialNextCursor, hasMore: initialHasMore },
  ];
  const items = pages.flatMap((p) => p.items);
  const hasMore = data ? (hasNextPage ?? false) : initialHasMore;

  if (isLoading && items.length === 0) {
    return <ListingGridSkeleton />;
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={SearchX}
        title="No listings match your search"
        description="Try adjusting your filters or searching a broader term."
      />
    );
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((listing, i) => (
          <ListingCard key={listing.id} listing={listing} priority={i < 4} />
        ))}
      </div>

      {hasMore && (
        <div ref={sentinelRef} className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
        </div>
      )}
    </div>
  );
}
