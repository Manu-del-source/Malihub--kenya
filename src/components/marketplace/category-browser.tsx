"use client";

import Link from "next/link";
import {
  Armchair,
  ChevronRight,
  CookingPot,
  Footprints,
  Headphones,
  Package,
  Shirt,
  Smartphone,
} from "lucide-react";

export type LiveCategory = { name: string; slug: string; count: number };

const CATEGORY_ICONS = {
  electronics: Headphones,
  phones: Smartphone,
  fashion: Shirt,
  "shoes-footwear": Footprints,
  furniture: Armchair,
  "home-appliances": CookingPot,
} as const;

const FALLBACK_CATEGORIES: LiveCategory[] = [
  { name: "Furniture", slug: "furniture", count: 0 },
  { name: "Electronics", slug: "electronics", count: 0 },
  { name: "Fashion", slug: "fashion", count: 0 },
  { name: "Home Appliances", slug: "home-appliances", count: 0 },
  { name: "Phones", slug: "phones", count: 0 },
  { name: "Shoes & Footwear", slug: "shoes-footwear", count: 0 },
];

export function CategoryBrowser({
  activeCategories = [],
}: {
  activeCategories?: LiveCategory[];
}) {
  const categories = activeCategories.length > 0
    ? activeCategories
    : FALLBACK_CATEGORIES;

  return (
    <section aria-label="Shop by category" className="overflow-hidden rounded-xl border border-foreground/10 bg-card sm:rounded-2xl">
      <div className="border-b border-foreground/10 px-4 py-3 sm:px-5">
        <h2 className="text-sm font-semibold text-foreground sm:text-base">
          All categories
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Choose a category to browse available products.
        </p>
      </div>

      <nav aria-label="All product categories" className="divide-y divide-foreground/10">
        {categories.map((category) => {
          const Icon = CATEGORY_ICONS[category.slug as keyof typeof CATEGORY_ICONS] ?? Package;

          return (
            <Link
              key={category.slug}
              href={`/categories/${encodeURIComponent(category.slug)}`}
              className="group flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-amber-400/5 focus-visible:bg-amber-400/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-400 sm:px-5"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-foreground/10 bg-background text-amber-400">
                <Icon className="h-5 w-5" strokeWidth={1.7} aria-hidden />
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground group-hover:text-amber-400">
                  {category.name}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {category.count} {category.count === 1 ? "listing" : "listings"}
                </span>
              </span>

              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-amber-400" aria-hidden />
            </Link>
          );
        })}
      </nav>
    </section>
  );
}
