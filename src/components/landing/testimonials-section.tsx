"use client";

import { motion } from "framer-motion";
import { SectionHeading } from "@/components/ui/section-heading";
import { Container } from "@/components/ui/container";
import { TestimonialCard } from "@/components/landing/testimonial-card";
import { TESTIMONIALS } from "@/lib/landing-data";
import { staggerContainer, defaultViewport } from "@/lib/motion";

export function TestimonialsSection() {
  return (
    <section className="py-24 sm:py-32">
      <Container className="flex flex-col gap-14">
        <SectionHeading
          eyebrow="Real sellers, real results"
          title="Trusted by buyers and sellers nationwide"
        />

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={defaultViewport}
          className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4"
        >
          {TESTIMONIALS.map((t) => (
            <TestimonialCard key={t.name} {...t} />
          ))}
        </motion.div>
      </Container>
    </section>
  );
}
