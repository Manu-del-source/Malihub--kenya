"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight, ArrowUpRight, Car, Home, Smartphone, Shirt, Sparkles, ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { GradientMeshBackground } from "@/components/landing/gradient-mesh-background";
import { HeroSearchBar } from "@/components/landing/hero-search-bar";
import { PopularSearches } from "@/components/landing/popular-searches";

const visualCategories = [
  { label: "Electronics", icon: Smartphone, className: "hero-tile-electronics" },
  { label: "Vehicles", icon: Car, className: "hero-tile-vehicles" },
  { label: "Fashion", icon: Shirt, className: "hero-tile-fashion" },
  { label: "Property & home", icon: Home, className: "hero-tile-home" },
];

export function HeroSection() {
  const reduceMotion = useReducedMotion();

  return (
    <section className="relative isolate overflow-hidden pb-16 pt-32 sm:pb-24 sm:pt-36 lg:pb-28 lg:pt-40">
      <GradientMeshBackground />
      <Container className="relative">
        <div className="grid items-center gap-12 lg:grid-cols-[1.08fr_0.92fr] lg:gap-10">
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 flex flex-col items-start gap-6"
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/[0.08] px-3.5 py-2 text-xs font-medium tracking-wide text-primary-400">
              <span className="h-1.5 w-1.5 rounded-full bg-primary-400 shadow-[0_0_12px_hsl(var(--primary)/0.8)]" />
              YOUR MARKETPLACE. YOUR KENYA.
            </span>

            <h1 className="max-w-2xl text-balance font-display text-5xl font-semibold leading-[0.99] tracking-[-0.045em] sm:text-6xl lg:text-7xl xl:text-[5.4rem]">
              Good finds.
              <br />
              <span className="copper-text">Closer to home.</span>
            </h1>

            <p className="max-w-xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
              Discover listings, compare details, and connect with sellers across Kenya. Your next find starts here.
            </p>

            <div className="w-full pt-1">
              <HeroSearchBar />
            </div>
            <div className="w-full">
              <PopularSearches />
            </div>

            <div className="flex w-full flex-col gap-3 pt-1 sm:w-auto sm:flex-row">
              <Button size="lg" asChild className="min-h-12 rounded-full px-6 shadow-[0_8px_28px_hsl(var(--primary)/0.15)]">
                <Link href="/marketplace">
                  Explore marketplace <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
                </Link>
              </Button>
              <Button size="lg" variant="secondary" asChild className="min-h-12 rounded-full px-6">
                <Link href="/register?role=seller">
                  Start selling <ArrowUpRight className="ml-1 h-4 w-4" aria-hidden />
                </Link>
              </Button>
            </div>

            <div className="flex items-center gap-2 pt-2 text-xs text-muted-foreground sm:text-sm">
              <ShieldCheck className="h-4 w-4 text-primary-400" aria-hidden />
              <span>Browse carefully. Ask questions. Make informed choices.</span>
            </div>
          </motion.div>

          <motion.div
            initial={reduceMotion ? false : { opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
            className="relative mx-auto w-full max-w-[34rem] lg:ml-auto"
            aria-label="Explore popular marketplace categories"
          >
            <div className="hero-orbit absolute inset-[8%] rounded-full border border-primary/10" aria-hidden />
            <div className="hero-orbit hero-orbit-delayed absolute inset-[17%] rounded-full border border-primary/[0.08]" aria-hidden />
            <div className="relative grid grid-cols-2 gap-3 sm:gap-4">
              {visualCategories.map(({ label, icon: Icon, className }, index) => (
                <Link
                  key={label}
                  href="/marketplace"
                  className={`hero-visual-tile group relative flex min-h-40 flex-col justify-between overflow-hidden rounded-2xl border border-white/[0.09] p-5 transition duration-300 hover:-translate-y-1 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-52 sm:p-6 ${className} ${index % 2 === 1 ? "sm:translate-y-7" : ""}`}
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
            <div className="relative mt-3 flex items-center justify-between rounded-2xl border border-white/[0.09] bg-[#10100f]/90 p-4 shadow-2xl backdrop-blur-xl sm:mt-10 sm:p-5">
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
