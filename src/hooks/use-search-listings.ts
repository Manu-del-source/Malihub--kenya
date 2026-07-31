"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import type { ListingCardData } from "@/components/marketplace/listing-card";

type SearchPage = { items: ListingCardData[]; nextCursor: string | null; hasMore: boolean };
type SearchApiResponse = { success: true; data: SearchPage };

export function useSearchListings(searchParamsString: string, initialPage?: SearchPage) {
  return useInfiniteQuery({
    queryKey: ["search-listings", searchParamsString],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams(searchParamsString);
      if (pageParam) params.set("cursor", pageParam);

      const res = await fetch(`/api/search?${params.toString()}`);
      if (!res.ok) throw new Error("Search request failed");
      const json = (await res.json()) as SearchApiResponse;
      return json.data;
    },
    initialPageParam: "",
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    // Seeds the cache with the page the server already rendered, so the
    // first client-side render doesn't re-fetch (and flash a skeleton
    // over) content that's already on the page.
    initialData: initialPage
      ? { pages: [initialPage], pageParams: [""] }
      : undefined,
  });
}
