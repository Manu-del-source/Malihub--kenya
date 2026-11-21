"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Container } from "@/components/ui/container";
import { HeroSearchBar } from "@/components/landing/hero-search-bar";

export function HeroSection() {
  return (
    <section className="relative isolate overflow-hidden border-b border-foreground/10 bg-background pb-6 pt-5 text-foreground sm:pb-9 sm:pt-9">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_78%_8%,rgba(184,147,74,0.12),transparent_42%)]"
        aria-hidden
      />
      <Container>
        <div className="mb-4 flex justify-end text-xs text-muted-foreground sm:mb-6">
          <Link
            href="/marketplace"
            className="inline-flex items-center gap-1.5 font-medium transition-colors hover:text-gold"
          >
            Browse all products <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>

        <div className="max-w-4xl">
          <h1 className="max-w-3xl font-display text-3xl font-semibold leading-[1.08] tracking-tight sm:text-4xl lg:text-5xl">
            Shop products from sellers across Kenya.
          </h1>
          <p className="mt-2 max-w-xl text-xs leading-5 text-muted-foreground sm:mt-3 sm:text-sm sm:leading-6">
            Browse, compare prices and find what you need.
          </p>
          <div className="mt-4 max-w-3xl sm:mt-5">
            <HeroSearchBar />
          </div>
        </div>
      </Container>
    </section>
  );
}
