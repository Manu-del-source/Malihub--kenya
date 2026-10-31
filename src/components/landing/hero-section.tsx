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
    <section className="relative isolate overflow-hidden border-b border-white/10 bg-[#090909] pb-7 pt-8 text-white sm:pb-10 sm:pt-12">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_78%_8%,rgba(184,147,74,0.20),transparent_38%),radial-gradient(ellipse_at_10%_80%,rgba(184,147,74,0.08),transparent_42%)]" aria-hidden />
      <Container>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-xs text-white/55">
          <span className="inline-flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-[#c9a568]" aria-hidden />Shop from sellers across Kenya</span>
          <Link href="/marketplace" className="inline-flex items-center gap-1.5 transition hover:text-[#e6c98b]">Explore all products <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.65fr)]">
          <div className="relative overflow-hidden rounded-2xl border border-[#c9a568]/25 bg-[linear-gradient(115deg,#1c1710_0%,#11100e_54%,#090909_100%)] p-5 sm:p-8 lg:min-h-[270px] lg:p-10">
            <div className="absolute -right-12 -top-24 h-64 w-64 rounded-full border border-[#c9a568]/10" aria-hidden />
            <div className="absolute -right-4 -top-16 h-48 w-48 rounded-full border border-[#c9a568]/10" aria-hidden />
            <div className="relative max-w-2xl">
              <h1 className="mt-4 max-w-xl font-display text-3xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">Find something <span className="text-[#d5b477]">worth keeping.</span></h1>
              <p className="mt-3 max-w-lg text-sm leading-6 text-white/65 sm:text-base">Discover products from Kenyan sellers. Compare prices, explore categories and find your next great deal.</p>
              <div className="mt-6"><HeroSearchBar /></div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {quickCategories.map(({ label, slug, icon: Icon }) => (
              <Link key={slug} href={`/categories/${slug}`} className="group flex min-h-28 flex-col justify-between rounded-xl border border-white/10 bg-[#121212] p-3.5 transition duration-200 hover:-translate-y-0.5 hover:border-[#c9a568]/50 hover:bg-[#17140f] sm:min-h-32 sm:p-4">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#c9a568]/20 bg-[#c9a568]/10 text-[#d5b477]"><Icon className="h-4.5 w-4.5" aria-hidden /></span>
                <span className="flex items-center justify-between gap-2 text-sm font-medium text-white">{label}<ArrowRight className="h-4 w-4 text-white/35 transition group-hover:translate-x-1 group-hover:text-[#e6c98b]" aria-hidden /></span>
              </Link>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}
