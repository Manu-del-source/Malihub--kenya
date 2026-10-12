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
        className="category-card group relative flex h-full min-h-40 flex-col justify-between gap-5 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#10100f] p-5 transition duration-300 hover:-translate-y-1 hover:border-primary/35 hover:shadow-[0_16px_42px_rgba(0,0,0,0.28)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-44 sm:p-6"
      >
        <div className="category-card-glow pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-primary/[0.07] blur-2xl transition group-hover:bg-primary/[0.17]" aria-hidden />
        <div className="relative flex items-start justify-between">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/20 bg-primary/[0.08] text-primary-400 transition duration-300 group-hover:scale-105 group-hover:bg-primary/[0.14]">
            <Icon className="h-5 w-5" aria-hidden />
          </div>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary-400" aria-hidden />
        </div>
        <div className="relative">
          <h3 className="font-medium tracking-tight text-foreground">{name}</h3>
          <p className="mt-1.5 text-xs text-muted-foreground">Explore category</p>
        </div>
      </Link>
    </motion.div>
  );
}
