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
            Shop products and local finds across Kenya
          </span>
          <Link
            href="/marketplace"
            className="inline-flex items-center gap-1.5 font-medium transition-colors hover:text-gold"
          >
            Browse all products <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>

        <div className="max-w-4xl">
          <h1 className="max-w-3xl font-display text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
            Find what you need, all in one place.
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
            Explore products from independent sellers across Kenya, compare prices and details, and connect directly with the seller.
          </p>
          <div className="mt-7 max-w-3xl">
            <HeroSearchBar />
          </div>
        </div>
      </Container>
    </section>
  );
}
