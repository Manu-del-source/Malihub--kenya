import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { MarketplaceBrowser } from "@/components/marketplace/marketplace-browser";

export const metadata: Metadata = {
  title: "Shop MaliHub",
  description: "Discover and shop products from independent sellers across Kenya.",
};

type BuyerAppPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Buyer-first PWA entry point. It reuses the live marketplace search and
 * listing services; the full marketing homepage remains available at "/".
 */
export default async function BuyerAppPage({ searchParams }: BuyerAppPageProps) {
  const rawParams = await searchParams;

  return (
    <main className="min-h-svh bg-background text-foreground">
      <Container className="py-4 sm:py-8">
        <MarketplaceBrowser
          rawParams={rawParams}
          heading="Find your next great deal"
        />
      </Container>
    </main>
  );
}
