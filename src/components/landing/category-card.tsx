"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  Car, Home, Smartphone, Tv, Sofa, Shirt, Sparkles, Wheat, Briefcase, Wrench,
  WashingMachine, Dumbbell, BookOpen, Baby, PawPrint, Package,
  type LucideIcon,
} from "lucide-react";
import { fadeUp } from "@/lib/motion";

const ICONS: Record<string, LucideIcon> = {
  Car, Home, Smartphone, Tv, Sofa, Shirt, Sparkles, Wheat, Briefcase, Wrench,
  WashingMachine, Dumbbell, BookOpen, Baby, PawPrint, Package,
};

export function CategoryCard({
  name,
  slug,
  iconName,
  listingCount,
}: {
  name: string;
  slug: string;
  iconName: string;
  listingCount: number;
}) {
  const Icon = ICONS[iconName] ?? Sparkles;

  return (
    <motion.div variants={fadeUp}>
      <Link
        href={`/categories/${slug}`}
        className="group relative flex flex-col gap-4 overflow-hidden rounded-xl border border-border bg-card p-5 transition-all duration-300 ease-premium hover:-translate-y-1 hover:border-primary/30 hover:shadow-glow-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div
          className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-primary/10 opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100"
          aria-hidden
        />
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary-400 transition-transform duration-300 group-hover:scale-110">
          <Icon className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h3 className="font-medium text-foreground">{name}</h3>
          <p className="text-xs text-muted-foreground">
            {listingCount.toLocaleString()} listings
          </p>
        </div>
      </Link>
    </motion.div>
  );
}
