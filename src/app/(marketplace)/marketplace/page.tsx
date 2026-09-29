import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { MarketplaceBrowser } from "@/components/marketplace/marketplace-browser";

export const metadata: Metadata = {
  title: "Marketplace",
  description: "Browse, search and filter listings across all 47 Kenyan counties.",
  alternates: { canonical: "/marketplace" },
};

type MarketplacePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * The canonical marketplace route — product listing, search, category and
 * county filters, sort and pagination over ACTIVE listings, all served from
 * the database through `searchListings`. It shares its implementation with
 * `/search` (MarketplaceBrowser) so the two can never diverge.
 *
 * Public by design: browsing the catalogue needs no session (see
 * `PROTECTED_PREFIXES` in src/lib/auth/config.ts).
 */
export default async function MarketplacePage({ searchParams }: MarketplacePageProps) {
  const rawParams = await searchParams;

  return (
    <Container className="py-10">
      <MarketplaceBrowser rawParams={rawParams} />
    </Container>
  );
}
