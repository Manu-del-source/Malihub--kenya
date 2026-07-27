"use client";

import * as Avatar from "@radix-ui/react-avatar";
import { motion } from "framer-motion";
import { Star } from "lucide-react";
import { fadeUp } from "@/lib/motion";
import { cn } from "@/utils";

export function TestimonialCard({
  name,
  role,
  quote,
  rating,
  initials,
}: {
  name: string;
  role: string;
  quote: string;
  rating: number;
  initials: string;
}) {
  return (
    <motion.figure
      variants={fadeUp}
      whileHover={{ y: -4 }}
      transition={{ duration: 0.3 }}
      className="flex h-full flex-col justify-between gap-6 rounded-xl border border-border bg-card p-6"
    >
      <div>
        <div className="mb-4 flex gap-0.5" aria-hidden>
          {Array.from({ length: 5 }).map((_, i) => (
            <Star
              key={i}
              className={cn(
                "h-4 w-4",
                i < rating ? "fill-primary-400 text-primary-400" : "fill-none text-muted-foreground/40"
              )}
            />
          ))}
        </div>
        <blockquote className="text-sm leading-relaxed text-foreground/90">“{quote}”</blockquote>
      </div>

      <figcaption className="flex items-center gap-3">
        <Avatar.Root className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-primary-400 to-secondary text-xs font-medium text-primary-foreground">
          <Avatar.Fallback>{initials}</Avatar.Fallback>
        </Avatar.Root>
        <div>
          <p className="text-sm font-medium text-foreground">{name}</p>
          <p className="text-xs text-muted-foreground">{role}</p>
        </div>
      </figcaption>
    </motion.figure>
  );
}
