"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight, ArrowUpRight, Sofa, Smartphone, Shirt, Sparkles, ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { GradientMeshBackground } from "@/components/landing/gradient-mesh-background";
import { HeroSearchBar } from "@/components/landing/hero-search-bar";
import { PopularSearches } from "@/components/landing/popular-searches";

const visualCategories = [
  { label: "Electronics", icon: Smartphone, className: "hero-tile-electronics" },
  { label: "Home essentials", icon: Sofa, className: "hero-tile-home" },
  { label: "Fashion", icon: Shirt, className: "hero-tile-fashion" },
  { label: "Beauty", icon: Sparkles, className: "hero-tile-fashion" },
];

export function HeroSection() {
  const reduceMotion = useReducedMotion();

  return (
    <section className="relative isolate overflow-hidden pb-10 pt-24 sm:pb-20 sm:pt-32 lg:pb-28 lg:pt-40">
      <GradientMeshBackground />
      <Container className="relative">
        <div className="grid items-center gap-8 lg:grid-cols-[1.08fr_0.92fr] lg:gap-10">
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 flex flex-col items-start gap-4 sm:gap-6"
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/[0.08] px-3 py-1.5 text-[10px] font-medium tracking-wide text-primary-400 sm:py-2 sm:text-xs">
              <span className="h-1.5 w-1.5 rounded-full bg-primary-400 shadow-[0_0_12px_hsl(var(--primary)/0.8)]" />
              YOUR MARKETPLACE. YOUR KENYA.
            </span>

            <h1 className="max-w-2xl text-balance font-display text-4xl font-semibold leading-[1.02] tracking-[-0.045em] sm:text-6xl lg:text-7xl xl:text-[5.4rem]">
              Good finds.
              <br />
              <span className="copper-text">Closer to home.</span>
            </h1>

            <p className="max-w-xl text-sm leading-6 text-muted-foreground sm:text-lg sm:leading-8">
              Discover listings, compare details, and connect with sellers across Kenya.
            </p>

            <div className="w-full pt-1">
              <HeroSearchBar />
            </div>
            <div className="w-full">
              <PopularSearches />
            </div>

            <div className="flex w-full gap-2 pt-1 sm:w-auto sm:gap-3">
              <Button size="lg" asChild className="min-h-11 flex-1 rounded-full px-3 text-sm sm:min-h-12 sm:flex-none sm:px-6 sm:text-base">
                <Link href="/marketplace">
                  Explore marketplace <ArrowRight className="ml-1 h-4 w-4 shrink-0" aria-hidden />
                </Link>
              </Button>
            </div>

            <div className="flex items-center gap-2 pt-1 text-[11px] text-muted-foreground sm:pt-2 sm:text-sm">
              <ShieldCheck className="h-4 w-4 shrink-0 text-primary-400" aria-hidden />
              <span>Browse carefully. Ask questions. Make informed choices.</span>
            </div>
          </motion.div>

          <motion.div
            initial={reduceMotion ? false : { opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
            className="relative mx-auto hidden w-full max-w-[34rem] lg:ml-auto lg:block"
            aria-label="Explore popular marketplace categories"
          >
            <div className="hero-orbit absolute inset-[8%] rounded-full border border-primary/10" aria-hidden />
            <div className="hero-orbit hero-orbit-delayed absolute inset-[17%] rounded-full border border-primary/[0.08]" aria-hidden />
            <div className="relative grid grid-cols-2 gap-3 sm:gap-4">
              {visualCategories.map(({ label, icon: Icon, className }, index) => (
                <Link
                  key={label}
                  href="/marketplace"
                  style={{ "--tile-delay": `${index * 75}ms` } as React.CSSProperties}
                  className={`hero-visual-tile hero-tile-enter group relative flex min-h-40 flex-col justify-between overflow-hidden rounded-2xl border border-white/[0.09] p-5 transition duration-300 hover:-translate-y-1 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-52 sm:p-6 ${className} ${index % 2 === 1 ? "sm:translate-y-7" : ""}`}
                >
                  <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-primary/[0.08] blur-2xl transition group-hover:bg-primary/[0.16]" aria-hidden />
                  <div className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-primary/20 bg-black/30 text-primary-400">
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="relative flex items-end justify-between gap-2">
                    <span className="text-sm font-medium text-foreground sm:text-base">{label}</span>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-primary-400 opacity-70 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100" aria-hidden />
                  </div>
                </Link>
              ))}
            </div>
            <div className="relative mt-10 flex items-center justify-between rounded-2xl border border-white/[0.09] bg-[#10100f]/90 p-5 shadow-2xl backdrop-blur-xl">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary-400">
                  <Sparkles className="h-4 w-4" aria-hidden />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Find something worth keeping</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Explore what’s listed on MaliHub</p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-primary-400" aria-hidden />
            </div>
          </motion.div>
        </div>
      </Container>
    </section>
  );
}
