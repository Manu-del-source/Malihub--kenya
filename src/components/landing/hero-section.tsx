"use client";

import Link from "next/link";
import { ArrowRight, MapPin } from "lucide-react";
import { Container } from "@/components/ui/container";
import { HeroSearchBar } from "@/components/landing/hero-search-bar";

export function HeroSection() {
  return (
    <section className="relative isolate overflow-hidden border-b border-foreground/10 bg-background pb-9 pt-8 text-foreground sm:pb-12 sm:pt-12">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_78%_8%,rgba(184,147,74,0.12),transparent_42%)]"
        aria-hidden
      />
      <Container>
        <div className="mb-7 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground sm:mb-9">
          <span className="inline-flex items-center gap-2">
            <MapPin className="h-3.5 w-3.5 text-gold" aria-hidden />
            A marketplace for buyers and sellers across Kenya
          </span>
          <Link
            href="/marketplace"
            className="inline-flex items-center gap-1.5 font-medium transition-colors hover:text-gold"
          >
            Browse all listings <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>

        <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.65fr)] lg:gap-14">
          <div className="max-w-3xl">
            <h1 className="max-w-2xl font-display text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
              Find what you need. Sell what you don’t.
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
              Discover local listings, compare prices and item details, then connect directly with sellers across Kenya.
            </p>
            <div className="mt-7 max-w-2xl">
              <HeroSearchBar />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <Link
              href="/marketplace"
              className="group flex min-h-24 items-center justify-between gap-4 border-y border-foreground/10 py-4 transition-colors hover:border-gold/45 sm:border sm:px-5 lg:min-h-28"
            >
              <span>
                <span className="block text-xs text-muted-foreground">Looking for something?</span>
                <span className="mt-1 block text-base font-semibold">Explore the marketplace</span>
              </span>
              <ArrowRight className="h-5 w-5 shrink-0 text-gold transition-transform group-hover:translate-x-1" aria-hidden />
            </Link>
            <Link
              href="/register?role=seller"
              className="group flex min-h-24 items-center justify-between gap-4 border-b border-foreground/10 py-4 transition-colors hover:border-gold/45 sm:border sm:px-5 lg:min-h-28"
            >
              <span>
                <span className="block text-xs text-muted-foreground">Have something to offer?</span>
                <span className="mt-1 block text-base font-semibold">Start selling on MaliHub</span>
              </span>
              <ArrowRight className="h-5 w-5 shrink-0 text-gold transition-transform group-hover:translate-x-1" aria-hidden />
            </Link>
          </div>
        </div>
      </Container>
    </section>
  );
}
