"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowUpRight,
  BookOpen,
  MapPin,
  Smartphone,
  Shirt,
  Sofa,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { HeroSearchBar } from "@/components/landing/hero-search-bar";
import { PopularSearches } from "@/components/landing/popular-searches";

const quickCategories: { label: string; icon: LucideIcon }[] = [
  { label: "Electronics", icon: Smartphone },
  { label: "Furniture", icon: Sofa },
  { label: "Fashion", icon: Shirt },
  { label: "Books", icon: BookOpen },
];

export function HeroSection() {
  const reduceMotion = useReducedMotion();

  return (
    <section className="relative isolate overflow-hidden border-b border-border/70 pb-12 pt-28 sm:pb-16 sm:pt-36 lg:pb-24 lg:pt-40">
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
        <div className="absolute inset-x-0 bottom-0 h-px bg-primary/25" />
      </div>

      <Container className="relative">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(22rem,0.9fr)] lg:gap-16">
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 flex min-w-0 flex-col items-start"
          >
            <h1 className="max-w-[11ch] text-balance font-display text-5xl font-medium leading-[0.98] tracking-[-0.045em] sm:text-6xl lg:text-7xl xl:text-[5.5rem]">
              Good finds.
              <br />
              <span className="text-primary-400">Closer to home.</span>
            </h1>

            <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
              Search listings, compare details and connect with sellers across Kenya.
            </p>

            <div className="mt-8 w-full max-w-3xl">
              <HeroSearchBar />
            </div>
            <div className="mt-4 w-full max-w-3xl">
              <PopularSearches />
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
              <Button size="lg" asChild className="min-h-12 rounded-full px-6">
                <Link href="/marketplace">
                  Explore listings <ArrowUpRight className="ml-2 h-4 w-4" aria-hidden />
                </Link>
              </Button>
              <Link href="/#categories" className="rounded-sm py-2 text-sm text-foreground/80 underline decoration-border underline-offset-4 transition-colors hover:text-primary-400 hover:decoration-primary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Browse categories
              </Link>
            </div>
          </motion.div>

          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
            className="relative mx-auto w-full max-w-xl lg:ml-auto"
            aria-label="Browse popular categories"
          >
            <div className="mb-4 flex items-center justify-between border-b border-border/80 pb-3">
              <h2 className="font-display text-lg font-medium tracking-tight sm:text-xl">Find something for today</h2>
              <span className="text-sm text-muted-foreground">Browse by category</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              {quickCategories.map(({ label, icon: Icon }, index) => (
                <Link
                  key={label}
                  href="/marketplace"
                  className={`group flex min-h-36 flex-col justify-between rounded-2xl border border-border/80 bg-card/70 p-4 transition-colors duration-200 hover:border-primary/45 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transform-none motion-reduce:transition-none sm:min-h-44 sm:p-5 ${index === 1 || index === 3 ? "sm:translate-y-5" : ""}`}
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/[0.07] text-primary-400">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="flex items-end justify-between gap-2 text-sm font-medium text-foreground sm:text-base">
                    {label}
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary-400" aria-hidden />
                  </span>
                </Link>
              ))}
            </div>
            <div className="mt-8 flex items-center gap-3 border-t border-border/80 pt-5 text-sm text-muted-foreground sm:mt-10">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-primary-400">
                <MapPin className="h-4 w-4" aria-hidden />
              </span>
              <span>Explore listings and locations from across Kenya.</span>
            </div>
          </motion.div>
        </div>
      </Container>
    </section>
  );
}
