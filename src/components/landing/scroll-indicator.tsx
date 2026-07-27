"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ChevronDown } from "lucide-react";

export function ScrollIndicator() {
  const reduce = useReducedMotion();

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 1.2, duration: 0.6 }}
      className="absolute bottom-8 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-2 text-muted-foreground sm:flex"
      aria-hidden
    >
      <span className="text-[11px] uppercase tracking-[0.2em]">Scroll</span>
      <motion.div
        animate={reduce ? undefined : { y: [0, 6, 0] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        className="flex h-9 w-6 items-start justify-center rounded-full border border-border pt-1.5"
      >
        <ChevronDown className="h-3 w-3" />
      </motion.div>
    </motion.div>
  );
}
