"use client";

import { motion } from "framer-motion";
import {
  ShieldCheck, BadgeCheck, Sparkles, Zap, MapPinned, Smartphone,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/utils";
import { fadeUp } from "@/lib/motion";

const ICONS: Record<string, LucideIcon> = {
  ShieldCheck, BadgeCheck, Sparkles, Zap, MapPinned, Smartphone,
};

export function FeatureBentoCard({
  title,
  description,
  icon,
  size,
}: {
  title: string;
  description: string;
  icon: string;
  size: "sm" | "lg";
}) {
  const Icon = ICONS[icon] ?? Sparkles;

  return (
    <motion.div
      variants={fadeUp}
      className={cn(
        "group relative overflow-hidden rounded-xl border border-border bg-card p-6 transition-colors duration-300 hover:border-primary/30 sm:p-8",
        size === "lg" ? "sm:col-span-2" : "sm:col-span-1"
      )}
    >
      <div
        className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br from-primary/20 to-cyan/10 opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-100"
        aria-hidden
      />
      <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-gradient-to-br from-primary/15 to-secondary/15 text-primary-400">
        <Icon className="h-5 w-5" aria-hidden />
      </div>
      <h3 className="mt-5 font-display text-xl font-medium">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
    </motion.div>
  );
}
