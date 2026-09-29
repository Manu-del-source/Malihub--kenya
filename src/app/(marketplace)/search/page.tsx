import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { MarketplaceBrowser } from "@/components/marketplace/marketplace-browser";

export const metadata: Metadata = {
  title: "Marketplace",
  description: "Search and filter listings across all 47 Kenyan counties.",
};

type SearchPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Legacy-compatible search route. Reads `searchParams`, which makes it
 * dynamic per request — same behaviour as always — and delegates to the
 * shared MarketplaceBrowser so `/search` and `/marketplace` can never drift
 * apart. New links should target `/marketplace`.
 */
export default async function SearchPage({ searchParams }: SearchPageProps) {
  const rawParams = await searchParams;

  return (
    <Container className="py-10">
      <MarketplaceBrowser rawParams={rawParams} />
    </Container>
  );
}
