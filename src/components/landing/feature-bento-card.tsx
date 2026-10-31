"use client";

import { motion } from "framer-motion";
import {
  MapPinned, Smartphone, Search, ClipboardList, Camera, Heart,
  type LucideIcon,
} from "lucide-react";
import { fadeUp } from "@/lib/motion";

const ICONS: Record<string, LucideIcon> = {
  MapPinned, Smartphone, Search, ClipboardList, Camera, Heart,
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
  const Icon = ICONS[icon] ?? Search;

  return (
    <motion.div
      variants={fadeUp}
      data-size={size}
      className="group flex min-h-44 flex-col items-start border-b border-border/80 py-6 sm:py-8"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border text-primary-400 transition-colors group-hover:border-primary/35">
        <Icon className="h-5 w-5" aria-hidden />
      </div>
      <h3 className="mt-5 font-display text-xl font-medium tracking-tight">{title}</h3>
      <p className="mt-2 max-w-md text-base leading-7 text-muted-foreground">{description}</p>
    </motion.div>
  );
}
