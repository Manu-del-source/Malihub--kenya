"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { ShieldCheck } from "lucide-react";
import { formatKes } from "@/utils";
import { cn } from "@/utils";

export function FloatingListingCard({
  title,
  priceCents,
  imageUrl,
  county,
  className,
  delay = 0,
  rotate = 0,
}: {
  title: string;
  priceCents: number;
  imageUrl: string;
  county: string;
  className?: string;
  delay?: number;
  rotate?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 40, rotate: rotate * 1.5 }}
      animate={{ opacity: 1, y: 0, rotate }}
      transition={{ duration: 0.9, delay, ease: [0.16, 1, 0.3, 1] }}
      style={{ ["--float-rotate" as string]: `${rotate}deg` }}
      className={cn(
        "glass w-52 animate-float-y rounded-xl p-2.5 sm:w-60",
        className
      )}
    >
      <div className="relative aspect-[4/3] overflow-hidden rounded-lg">
        <Image src={imageUrl} alt="" fill sizes="240px" className="object-cover" />
        <span className="glass-sm absolute left-2 top-2 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] text-cyan">
          <ShieldCheck className="h-3 w-3" aria-hidden />
          Verified
        </span>
      </div>
      <div className="px-1 pt-2">
        <p className="font-mono text-sm font-medium tabular-nums">{formatKes(priceCents)}</p>
        <p className="truncate text-xs text-muted-foreground">
          {title} · {county}
        </p>
      </div>
    </motion.div>
  );
}
