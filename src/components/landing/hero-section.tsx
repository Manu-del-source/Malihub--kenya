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
import { ScrollIndicator } from "@/components/landing/scroll-indicator";
import { fadeUpLarge, staggerContainer } from "@/lib/motion";

export function HeroSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });

  // Subtle parallax for the hero content only.
  const contentY = useTransform(scrollYProgress, [0, 1], [0, reduceMotion ? 0 : 60]);
  const contentOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0]);

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
            A marketplace for Kenya
          </motion.span>

          <motion.h1
            variants={fadeUpLarge}
            className="text-balance font-display text-4xl font-medium leading-[1.05] sm:text-6xl md:text-7xl"
          >
            Buy and sell across
            <br />
            <span className="bg-gradient-to-r from-primary-400 via-primary-500 to-secondary bg-clip-text text-transparent">
              Kenya.
            </span>
          </motion.h1>

          <motion.p
            variants={fadeUpLarge}
            className="text-balance max-w-xl text-base text-muted-foreground sm:text-lg"
          >
            Browse available listings, compare prices, and connect with sellers. Explore products across categories and find items that match your needs.
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
              <Link href="/marketplace">Explore marketplace</Link>
            </Button>
          </motion.div>
        </motion.div>

      </Container>

      <ScrollIndicator />
    </section>
  );
}
