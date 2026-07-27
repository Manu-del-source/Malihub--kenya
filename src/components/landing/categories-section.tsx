"use client";

import { motion } from "framer-motion";
import { SectionHeading } from "@/components/ui/section-heading";
import { Container } from "@/components/ui/container";
import { CategoryCard } from "@/components/landing/category-card";
import { DEFAULT_CATEGORIES } from "@/lib/constants";
import { CATEGORY_LISTING_COUNTS } from "@/lib/landing-data";
import { staggerContainer, defaultViewport } from "@/lib/motion";

export function CategoriesSection() {
  return (
    <section id="categories" className="py-24 sm:py-32">
      <Container className="flex flex-col gap-14">
        <SectionHeading
          eyebrow="Browse"
          title="Whatever you need, it's here"
          subtitle="Ten categories covering everything Kenyans buy and sell every day — each one searchable down to the sub-county."
        />

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={defaultViewport}
          className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5"
        >
          {DEFAULT_CATEGORIES.map((category) => (
            <CategoryCard
              key={category.slug}
              name={category.name}
              slug={category.slug}
              iconName={category.iconName}
              listingCount={CATEGORY_LISTING_COUNTS[category.slug] ?? 0}
            />
          ))}
        </motion.div>
      </Container>
    </section>
  );
}
