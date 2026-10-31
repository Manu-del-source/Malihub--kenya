"use client";

import { motion } from "framer-motion";
import { Container } from "@/components/ui/container";
import { CategoryCard } from "@/components/landing/category-card";
import { DEFAULT_CATEGORIES } from "@/lib/constants";
import { staggerContainer, defaultViewport } from "@/lib/motion";

export function CategoriesSection() {
  return (
    <section id="categories" className="py-16 sm:py-24 lg:py-32">
      <Container className="flex flex-col gap-8 sm:gap-12">
        <div className="flex flex-col justify-between gap-4 border-b border-border/80 pb-6 sm:flex-row sm:items-end sm:pb-8">
          <h2 className="max-w-xl font-display text-3xl font-medium leading-tight tracking-[-0.035em] sm:text-4xl lg:text-5xl">Start with a category</h2>
          <p className="max-w-sm text-base leading-7 text-muted-foreground">Browse the categories available on MaliHub and open a listing for more details.</p>
        </div>

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
