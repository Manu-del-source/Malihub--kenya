"use client";

import { motion } from "framer-motion";
import { SectionHeading } from "@/components/ui/section-heading";
import { Container } from "@/components/ui/container";
import { CategoryCard } from "@/components/landing/category-card";
import { DEFAULT_CATEGORIES } from "@/lib/constants";
import { staggerContainer, defaultViewport } from "@/lib/motion";

export function CategoriesSection() {
  return (
    <section id="categories" className="py-10 sm:py-20 lg:py-28">
      <Container className="flex flex-col gap-6 sm:gap-10 lg:gap-14">
        <SectionHeading
          eyebrow="Browse"
          title="Shop by category"
          subtitle="Find listings across MaliHub."
        />

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={defaultViewport}
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5"
        >
          {DEFAULT_CATEGORIES.map((category) => (
            <CategoryCard
              key={category.slug}
              name={category.name}
              slug={category.slug}
              iconName={category.iconName}
            />
          ))}
        </motion.div>
      </Container>
    </section>
  );
}
