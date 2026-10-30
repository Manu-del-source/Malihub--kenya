"use client";

import { motion } from "framer-motion";
import { SectionHeading } from "@/components/ui/section-heading";
import { Container } from "@/components/ui/container";
import { FeatureBentoCard } from "@/components/landing/feature-bento-card";
import { WHY_MALIHUB_FEATURES } from "@/lib/landing-data";
import { staggerContainer, defaultViewport } from "@/lib/motion";

export function WhyMaliHubSection() {
  return (
    <section id="why-malihub" className="border-y border-border/60 bg-card/20 py-10 sm:py-20 lg:py-28">
      <Container className="flex flex-col gap-6 sm:gap-10 lg:gap-14">
        <SectionHeading
          eyebrow="Why MaliHub"
          title="Shop with more confidence"
          subtitle="Useful details to help you make informed buying decisions."
        />

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={defaultViewport}
          className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4"
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
