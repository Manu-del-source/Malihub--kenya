"use client";

import { motion } from "framer-motion";
import { fadeUp } from "@/lib/motion";

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={fadeUp}
      className="glass flex flex-col gap-6 rounded-2xl p-8"
    >
      <div className="flex flex-col gap-1.5 text-center">
        <h1 className="font-display text-2xl font-medium">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>

      {children}

      {footer && <div className="text-center text-sm text-muted-foreground">{footer}</div>}
    </motion.div>
  );
}
