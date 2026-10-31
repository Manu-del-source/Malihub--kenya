"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  Home, Smartphone, Tv, Sofa, Shirt, Sparkles, Wheat, Briefcase, Wrench,
  WashingMachine, Dumbbell, BookOpen, Baby, PawPrint, Package, Footprints,
  ArrowUpRight, type LucideIcon,
} from "lucide-react";
import { fadeUp } from "@/lib/motion";

const ICONS: Record<string, LucideIcon> = {
  Home, Smartphone, Tv, Sofa, Shirt, Sparkles, Wheat, Briefcase, Wrench,
  WashingMachine, Dumbbell, BookOpen, Baby, PawPrint, Package, Footprints,
};

export function CategoryCard({ name, slug, iconName }: { name: string; slug: string; iconName: string }) {
  const Icon = ICONS[iconName] ?? Sparkles;

  return (
    <motion.div variants={fadeUp} className="h-full">
      <Link
        href={`/categories/${slug}`}
        className="category-card group flex h-full min-h-28 items-center gap-3 rounded-xl border border-border/80 bg-transparent p-3 transition-colors duration-200 hover:border-primary/45 hover:bg-card/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-32 sm:gap-4 sm:p-4"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/[0.07] text-primary-400 transition-colors group-hover:bg-primary/[0.12] sm:h-11 sm:w-11">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1 text-sm font-medium leading-5 text-foreground sm:text-base">{name}</span>
        <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary-400" aria-hidden />
      </Link>
    </motion.div>
  );
}
