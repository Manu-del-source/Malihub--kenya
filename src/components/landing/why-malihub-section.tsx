"use client";

import { motion } from "framer-motion";
import { SectionHeading } from "@/components/ui/section-heading";
import { Container } from "@/components/ui/container";
import { FeatureBentoCard } from "@/components/landing/feature-bento-card";
import { WHY_MALIHUB_FEATURES } from "@/lib/landing-data";
import { staggerContainer, defaultViewport } from "@/lib/motion";

export function WhyMaliHubSection() {
  return (
    <section id="why-malihub" className="py-24 sm:py-32">
      <Container className="flex flex-col gap-14">
        <SectionHeading
          eyebrow="Why MaliHub"
          title="Built for trust, not just transactions"
          subtitle="Every feature exists to answer one question: can I trust the person on the other side of this listing?"
        />

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={defaultViewport}
          className="grid grid-cols-1 gap-4 sm:grid-cols-3"
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
