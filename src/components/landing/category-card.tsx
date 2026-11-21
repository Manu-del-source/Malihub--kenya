"use client";

import Link from "next/link";
import {
  Smartphone, Tv, Sofa, Shirt, Sparkles, Wheat, Briefcase, Wrench,
  WashingMachine, Dumbbell, BookOpen, Baby, PawPrint, Package, Footprints,
  ArrowUpRight, type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  Smartphone, Tv, Sofa, Shirt, Sparkles, Wheat, Briefcase, Wrench,
  WashingMachine, Dumbbell, BookOpen, Baby, PawPrint, Package, Footprints,
};

const DESCRIPTIONS: Record<string, string> = {
  electronics: "Gadgets, computers and everyday tech",
  phones: "Smartphones and mobile essentials",
  fashion: "Clothing, accessories and personal style",
  "shoes-footwear": "Shoes for work, weekends and everywhere",
  furniture: "Make your space feel like home",
  "home-appliances": "Useful upgrades for every home",
  beauty: "Beauty, grooming and personal care",
  agriculture: "Farm supplies, tools and produce",
  jobs: "Opportunities from across Kenya",
  services: "Find people who can get it done",
  sports: "Gear for training, play and the outdoors",
  books: "Reading, learning and reference",
  kids: "Everyday finds for growing families",
  pets: "Supplies and essentials for your pets",
  other: "More finds from independent sellers",
};

const FEATURE_LAYOUT = [
  "col-span-2 min-h-[220px] sm:col-span-2 lg:col-span-6 lg:row-span-2 lg:min-h-[316px]",
  "col-span-1 min-h-[166px] lg:col-span-3 lg:min-h-[150px]",
  "col-span-1 min-h-[166px] lg:col-span-3 lg:min-h-[150px]",
];

export function CategoryCard({
  name,
  slug,
  iconName,
  count,
  featured = false,
  position = 0,
}: {
  name: string;
  slug: string;
  iconName: string;
  count?: number;
  featured?: boolean;
  position?: number;
}) {
  const Icon = ICONS[iconName] ?? Package;
  const layout = featured
    ? FEATURE_LAYOUT[position] ?? "col-span-1 min-h-[166px] lg:col-span-3"
    : "col-span-1 min-h-[142px] lg:col-span-3";
  const featuredStyle = position === 0
    ? "bg-gradient-to-br from-primary/[0.17] via-card to-card"
    : position === 1
      ? "bg-gradient-to-br from-card via-primary/[0.09] to-card"
      : "bg-gradient-to-br from-primary/[0.09] via-card to-card";

  return (
    <Link
      href={`/categories/${slug}`}
      className={`group relative isolate flex min-w-0 flex-col justify-between overflow-hidden rounded-2xl border border-border/75 p-4 transition duration-300 hover:-translate-y-1 hover:border-primary/50 hover:shadow-[0_16px_40px_-24px_hsl(var(--primary)/0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5 ${layout} ${featured ? featuredStyle : "bg-card/55 hover:bg-card"}`}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-8 -top-10 -z-10 h-36 w-36 rounded-full bg-primary/[0.055] blur-2xl transition duration-500 group-hover:bg-primary/[0.13] group-hover:scale-125"
      />
      <div className="flex items-start justify-between gap-3">
        <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border border-primary/20 bg-background/60 text-primary-400 ${featured && position === 0 ? "sm:h-11 sm:w-11" : ""}`}>
          <Icon className={featured && position === 0 ? "h-5 w-5 sm:h-6 sm:w-6" : "h-[18px] w-[18px]"} strokeWidth={1.7} aria-hidden />
        </span>
        <span className="text-[10px] font-medium tabular-nums tracking-[0.12em] text-muted-foreground/65">
          {String(position + 1).padStart(2, "0")}
        </span>
      </div>

      <div className="relative z-10 mt-8 max-w-[19rem]">
        <h3 className={`font-display font-medium tracking-tight text-foreground transition-colors group-hover:text-primary-300 ${featured && position === 0 ? "text-2xl sm:text-3xl" : "text-base sm:text-lg"}`}>
          {name}
        </h3>
        <p className={`mt-1.5 max-w-[17rem] leading-5 text-muted-foreground ${featured && position === 0 ? "text-sm sm:text-base sm:leading-6" : "text-xs"}`}>
          {DESCRIPTIONS[slug] ?? "Explore listings from sellers across Kenya"}
          {typeof count === "number" ? ` · ${count} listing${count === 1 ? "" : "s"}` : ""}
        </p>
        <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary-400 opacity-90 transition-all group-hover:gap-2">
          Explore <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        </span>
      </div>

      {featured && position === 0 && (
        <Icon
          aria-hidden
          className="pointer-events-none absolute -bottom-8 -right-5 -z-10 h-44 w-44 rotate-[-12deg] text-primary/[0.075] transition duration-500 group-hover:rotate-[-4deg] group-hover:scale-110 sm:h-56 sm:w-56"
          strokeWidth={0.8}
        />
      )}
    </Link>
  );
}