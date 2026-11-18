"use client";

import Link from "next/link";
import {
  Home, Smartphone, Tv, Sofa, Shirt, Sparkles, Wheat, Briefcase, Wrench,
  WashingMachine, Dumbbell, BookOpen, Baby, PawPrint, Package, Footprints,
  ArrowUpRight, type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  Home, Smartphone, Tv, Sofa, Shirt, Sparkles, Wheat, Briefcase, Wrench,
  WashingMachine, Dumbbell, BookOpen, Baby, PawPrint, Package, Footprints,
};

export function CategoryCard({ name, slug, iconName }: { name: string; slug: string; iconName: string }) {
  const Icon = ICONS[iconName] ?? Sparkles;

  return (
    <Link
      href={`/categories/${slug}`}
      className="group flex min-h-[5.5rem] min-w-0 items-center gap-2.5 rounded-xl border border-border/80 bg-card/40 p-3 transition-colors duration-200 hover:border-primary/45 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-24 sm:gap-3 sm:p-3.5"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/[0.07] text-primary-400 transition-colors group-hover:bg-primary/[0.13] sm:h-10 sm:w-10">
        <Icon className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 text-xs font-medium leading-5 text-foreground sm:text-sm">
        {name}
      </span>
      <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary-400" aria-hidden />
    </Link>
  );
}
