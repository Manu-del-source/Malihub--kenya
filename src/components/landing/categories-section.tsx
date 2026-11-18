import { Container } from "@/components/ui/container";
import { CategoryCard } from "@/components/landing/category-card";
import { DEFAULT_CATEGORIES } from "@/lib/constants";

export function CategoriesSection() {
  return (
    <section id="categories" className="border-b border-border/70 py-14 sm:py-20 lg:py-24">
      <Container className="flex flex-col gap-7 sm:gap-9">
        <div className="flex flex-col justify-between gap-3 border-b border-border/80 pb-5 sm:flex-row sm:items-end sm:pb-7">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary-400">
              Explore MaliHub
            </p>
            <h2 className="max-w-xl font-display text-3xl font-medium leading-tight tracking-[-0.035em] sm:text-4xl">
              Browse by category
            </h2>
          </div>
          <p className="max-w-sm text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
            Find products and services by starting with what you need.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
          {DEFAULT_CATEGORIES.map((category) => (
            <CategoryCard
              key={category.slug}
              name={category.name}
              slug={category.slug}
              iconName={category.iconName}
            />
          ))}
        </div>
      </Container>
    </section>
  );
}
