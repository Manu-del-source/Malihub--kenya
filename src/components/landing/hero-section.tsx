"use client";

import { useRef } from "react";
import Link from "next/link";
import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { GradientMeshBackground } from "@/components/landing/gradient-mesh-background";
import { HeroSearchBar } from "@/components/landing/hero-search-bar";
import { PopularSearches } from "@/components/landing/popular-searches";
import { FloatingListingCard } from "@/components/landing/floating-listing-card";
import { ScrollIndicator } from "@/components/landing/scroll-indicator";
import { FEATURED_LISTINGS } from "@/lib/landing-data";
import { fadeUpLarge, staggerContainer } from "@/lib/motion";

export function HeroSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });

  // Subtle parallax only — content drifts a little slower than the scroll,
  // floating cards a little faster, nothing dramatic.
  const contentY = useTransform(scrollYProgress, [0, 1], [0, reduceMotion ? 0 : 60]);
  const contentOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0]);
  const cardsY = useTransform(scrollYProgress, [0, 1], [0, reduceMotion ? 0 : -120]);

  return (
    <section
      ref={sectionRef}
      className="relative flex min-h-[100svh] items-center overflow-hidden pt-28 sm:pt-32"
    >
      <GradientMeshBackground />

      <Container className="relative">
        <motion.div
          style={{ y: contentY, opacity: contentOpacity }}
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="mx-auto flex max-w-3xl flex-col items-center gap-7 text-center"
        >
          <motion.span
            variants={fadeUpLarge}
            className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary-400"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Now live in all 47 counties
          </motion.span>

          <motion.h1
            variants={fadeUpLarge}
            className="text-balance font-display text-4xl font-medium leading-[1.05] sm:text-6xl md:text-7xl"
          >
            Buy and sell anything,
            <br />
            <span className="bg-gradient-to-r from-primary-400 via-primary-500 to-secondary bg-clip-text text-transparent">
              anywhere in Kenya.
            </span>
          </motion.h1>

          <motion.p
            variants={fadeUpLarge}
            className="text-balance max-w-xl text-base text-muted-foreground sm:text-lg"
          >
            A premium marketplace with verified sellers, secure M-Pesa checkout,
            and a search that actually understands what you&rsquo;re looking for.
          </motion.p>

          <motion.div variants={fadeUpLarge} className="w-full">
            <HeroSearchBar />
          </motion.div>

          <motion.div variants={fadeUpLarge}>
            <PopularSearches />
          </motion.div>

          <motion.div variants={fadeUpLarge} className="flex flex-col gap-3 sm:flex-row">
            <Button size="lg" asChild>
              <Link href="/register?role=seller">
                Start selling
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
            <Button size="lg" variant="secondary" asChild>
              <Link href="/search">Explore marketplace</Link>
            </Button>
          </motion.div>
        </motion.div>

        {/* Floating glass listing cards — desktop only, purely atmospheric */}
        <motion.div style={{ y: cardsY }} className="pointer-events-none hidden lg:block" aria-hidden>
          <div className="absolute left-0 top-24 xl:left-8">
            <FloatingListingCard
              title={FEATURED_LISTINGS[1]!.title}
              priceCents={FEATURED_LISTINGS[1]!.priceCents}
              imageUrl={FEATURED_LISTINGS[1]!.imageUrl}
              county={FEATURED_LISTINGS[1]!.county}
              rotate={-6}
              delay={0.5}
            />
          </div>
          <div className="absolute right-0 top-8 xl:right-8">
            <FloatingListingCard
              title={FEATURED_LISTINGS[0]!.title}
              priceCents={FEATURED_LISTINGS[0]!.priceCents}
              imageUrl={FEATURED_LISTINGS[0]!.imageUrl}
              county={FEATURED_LISTINGS[0]!.county}
              rotate={5}
              delay={0.7}
            />
          </div>
          <div className="absolute bottom-8 right-16 xl:right-24">
            <FloatingListingCard
              title={FEATURED_LISTINGS[2]!.title}
              priceCents={FEATURED_LISTINGS[2]!.priceCents}
              imageUrl={FEATURED_LISTINGS[2]!.imageUrl}
              county={FEATURED_LISTINGS[2]!.county}
              rotate={-3}
              delay={0.9}
              className="w-44"
            />
          </div>
        </motion.div>
      </Container>

      <ScrollIndicator />
    </section>
  );
}
