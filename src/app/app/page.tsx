import Link from "next/link";
import type { Metadata } from "next";
import { ShoppingCart, UserRound } from "lucide-react";
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
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-xl">
        <Container className="flex h-14 items-center justify-between sm:h-16">
          <Link href="/app" className="flex items-center gap-2" aria-label="MaliHub shop home">
            <span aria-hidden className="brand-mark flex h-9 w-9 items-center justify-center rounded-xl text-base font-extrabold text-primary-foreground">M</span>
            <span className="font-display text-lg font-bold tracking-tight">
              Mali<span className="copper-text">Hub</span>
            </span>
          </Link>
          <nav aria-label="Buyer shortcuts" className="flex items-center gap-1">
            <Link href="/buyer/cart" aria-label="Shopping cart" className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground">
              <ShoppingCart className="h-5 w-5" aria-hidden />
            </Link>
            <Link href="/account" aria-label="Your account" className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground">
              <UserRound className="h-5 w-5" aria-hidden />
            </Link>
          </nav>
        </Container>
      </header>
      <Container className="py-4 sm:py-8">
        <MarketplaceBrowser
          rawParams={rawParams}
          heading="Find your next great deal"
        />
      </Container>
    </main>
  );
}
