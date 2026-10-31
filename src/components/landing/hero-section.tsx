"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, Smartphone, Shirt, Sofa, MapPin, type LucideIcon } from "lucide-react";
import { Container } from "@/components/ui/container";
import { HeroSearchBar } from "@/components/landing/hero-search-bar";

const quickCategories: { label: string; slug: string; icon: LucideIcon }[] = [
  { label: "Electronics", slug: "electronics", icon: Smartphone },
  { label: "Furniture", slug: "furniture", icon: Sofa },
  { label: "Fashion", slug: "fashion", icon: Shirt },
  { label: "Books", slug: "books", icon: BookOpen },
];

export function HeroSection() {
  return (
    <section className="relative isolate overflow-hidden border-b border-foreground/10 bg-background pb-7 pt-8 text-foreground sm:pb-10 sm:pt-12">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_78%_8%,rgba(184,147,74,0.20),transparent_38%),radial-gradient(ellipse_at_10%_80%,rgba(184,147,74,0.08),transparent_42%)]" aria-hidden />
      <Container>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-gold" aria-hidden />Shop from sellers across Kenya</span>
          <Link href="/marketplace" className="inline-flex items-center gap-1.5 transition hover:text-gold">Explore all products <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.65fr)]">
          <div className="relative overflow-hidden rounded-2xl border border-gold/25 bg-[linear-gradient(115deg,hsl(var(--card))_0%,hsl(var(--background))_100%)] p-5 sm:p-8 lg:min-h-[270px] lg:p-10">
            <div className="absolute -right-12 -top-24 h-64 w-64 rounded-full border border-gold/10" aria-hidden />
            <div className="absolute -right-4 -top-16 h-48 w-48 rounded-full border border-gold/10" aria-hidden />
            <div className="relative max-w-2xl">
              <h1 className="mt-4 max-w-xl font-display text-3xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">Find something <span className="text-gold">worth keeping.</span></h1>
              <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground sm:text-base">Discover products from Kenyan sellers. Compare prices, explore categories and find your next great deal.</p>
              <div className="mt-6"><HeroSearchBar /></div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {quickCategories.map(({ label, slug, icon: Icon }) => (
              <Link key={slug} href={`/categories/${slug}`} className="group flex min-h-28 flex-col justify-between rounded-xl border border-foreground/10 bg-card p-3.5 transition duration-200 hover:-translate-y-0.5 hover:border-gold/50 hover:bg-card sm:min-h-32 sm:p-4">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-gold/20 bg-gold/10 text-gold"><Icon className="h-4.5 w-4.5" aria-hidden /></span>
                <span className="flex items-center justify-between gap-2 text-sm font-medium text-foreground">{label}<ArrowRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-gold" aria-hidden /></span>
              </Link>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}
