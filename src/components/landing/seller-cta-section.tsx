"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Camera, Wallet, TrendingUp, Tag, ArrowRight, Check } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fadeUp, fadeIn, defaultViewport } from "@/lib/motion";

const BENEFITS = [
  "List in under two minutes, from your phone",
  "Get paid instantly via M-Pesa — no waiting on transfers",
  "Reach buyers in all 47 counties, not just your area",
  "Verified badge builds trust before the first message",
];

/** Abstract "list → sell → get paid" composition — built entirely from
 * layered glass cards and icons, so the seller CTA doesn't depend on an
 * external illustration asset. */
function SellerIllustration() {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-sm" aria-hidden>
      <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary/20 via-secondary/10 to-cyan/10 blur-3xl" />

      <motion.div
        animate={{ y: [0, -10, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
        className="glass absolute left-4 top-8 flex h-16 w-16 items-center justify-center rounded-xl sm:left-8"
      >
        <Camera className="h-6 w-6 text-primary-400" />
      </motion.div>

      <motion.div
        animate={{ y: [0, 12, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
        className="glass absolute right-2 top-20 flex h-16 w-16 items-center justify-center rounded-xl sm:right-6"
      >
        <Tag className="h-6 w-6 text-cyan" />
      </motion.div>

      <motion.div
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut", delay: 0.8 }}
        className="glass absolute bottom-16 left-0 flex h-16 w-16 items-center justify-center rounded-xl sm:left-4"
      >
        <Wallet className="h-6 w-6 text-secondary" />
      </motion.div>

      <div className="glass absolute inset-x-10 bottom-4 flex items-center justify-between rounded-xl p-4 sm:inset-x-16">
        <div>
          <p className="text-xs text-muted-foreground">This month</p>
          <p className="font-mono text-lg font-medium tabular-nums">KSh 84,200</p>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-success/15 text-success">
          <TrendingUp className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

export function SellerCtaSection() {
  return (
    <section id="sell" className="py-24 sm:py-32">
      <Container>
        <div className="glass grid grid-cols-1 items-center gap-12 rounded-2xl p-8 sm:p-12 lg:grid-cols-2 lg:p-16">
          <motion.div variants={fadeIn} initial="hidden" whileInView="visible" viewport={defaultViewport}>
            <SellerIllustration />
          </motion.div>

          <motion.div
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={defaultViewport}
            className="flex flex-col gap-6"
          >
            <Badge variant="primary" className="w-fit">
              For sellers
            </Badge>
            <h2 className="text-balance font-display text-3xl font-medium leading-tight sm:text-4xl">
              Turn what you&rsquo;re not using into what you need.
            </h2>
            <ul className="flex flex-col gap-3">
              {BENEFITS.map((benefit) => (
                <li key={benefit} className="flex items-start gap-3 text-sm text-muted-foreground">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
                    <Check className="h-3 w-3" />
                  </span>
                  {benefit}
                </li>
              ))}
            </ul>
            <Button size="lg" asChild className="w-fit">
              <Link href="/register?role=seller">
                Start selling today
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
          </motion.div>
        </div>
      </Container>
    </section>
  );
}
