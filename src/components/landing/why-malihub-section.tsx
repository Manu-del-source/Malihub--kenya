"use client";

import { motion } from "framer-motion";
import { Container } from "@/components/ui/container";
import { FeatureBentoCard } from "@/components/landing/feature-bento-card";
import { WHY_MALIHUB_FEATURES } from "@/lib/landing-data";
import { staggerContainer, defaultViewport } from "@/lib/motion";

export function WhyMaliHubSection() {
  return (
    <section id="why-malihub" className="border-y border-border/60 bg-card/25 py-16 sm:py-24 lg:py-32">
      <Container className="flex flex-col gap-8 sm:gap-12">
        <div className="grid gap-4 border-b border-border/80 pb-6 sm:grid-cols-[1fr_auto] sm:items-end sm:pb-8">
          <h2 className="max-w-xl font-display text-3xl font-medium leading-tight tracking-[-0.035em] sm:text-4xl lg:text-5xl">A clearer way to browse</h2>
          <p className="max-w-sm text-base leading-7 text-muted-foreground">Useful details and simple tools for buyers and sellers.</p>
        </div>

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={defaultViewport}
          className="grid grid-cols-1 gap-x-8 sm:grid-cols-2 lg:grid-cols-3"
        >
          {WHY_MALIHUB_FEATURES.map((feature) => (
            <FeatureBentoCard
              key={feature.title}
              title={feature.title}
              description={feature.description}
              icon={feature.icon}
              size={feature.size}
            />
          ))}
        </motion.div>
      </Container>
    </section>
  );
}
