"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Boxes, PackageCheck, Store, Truck } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fadeUp, defaultViewport } from "@/lib/motion";

const BENEFITS = [
  { icon: Store, title: "Reach more buyers", text: "Make your catalogue discoverable to customers and independent MaliHub sellers." },
  { icon: Boxes, title: "Keep control of stock", text: "You remain the source of the products and confirm availability before an order is fulfilled." },
  { icon: PackageCheck, title: "Agree your wholesale terms", text: "Discuss product costs, order handling, returns and payment terms before approval." },
  { icon: Truck, title: "Work with a delivery arrangement", text: "Prepare and package orders. Courier arrangements and delivery charges are agreed separately; MaliHub does not operate its own delivery fleet." },
];

export function SupplierCtaSection() {
  return (
    <section id="supply" className="py-16 sm:py-24">
      <Container>
        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={defaultViewport}
          className="relative overflow-hidden rounded-3xl border border-primary/20 bg-[radial-gradient(ellipse_at_top_right,rgba(184,147,74,0.13),transparent_48%),#111111] p-6 sm:p-10 lg:p-14"
        >
          <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="flex flex-col items-start gap-5">
              <Badge variant="primary">For wholesalers and distributors</Badge>
              <h2 className="max-w-2xl text-balance font-display text-3xl font-medium leading-tight sm:text-4xl">
                Your products. More ways to reach customers.
              </h2>
              <p className="max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
                MaliHub is inviting Kenyan wholesalers, manufacturers and distributors to discuss listing their catalogues on our marketplace. You remain the product supplier; approved orders are handled under terms agreed with you.
              </p>
              <ul className="grid gap-3 sm:grid-cols-2">
                {BENEFITS.slice(0, 2).map(({ icon: Icon, title, text }) => (
                  <li key={title} className="flex gap-3 rounded-2xl border border-foreground/[0.07] bg-black/20 p-4">
                    <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary-400" aria-hidden />
                    <span><strong className="block text-sm font-medium">{title}</strong><span className="mt-1 block text-xs leading-5 text-muted-foreground">{text}</span></span>
                  </li>
                ))}
              </ul>
              <Button size="lg" asChild className="mt-1">
                <Link href="/become-a-supplier">Explore supplier partnership <ArrowRight className="h-4 w-4" aria-hidden /></Link>
              </Button>
            </div>
            <div className="grid gap-3">
              {BENEFITS.slice(2).map(({ icon: Icon, title, text }) => (
                <div key={title} className="flex gap-4 rounded-2xl border border-foreground/[0.08] bg-black/25 p-5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary-400">
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{text}</p></div>
                </div>
              ))}
              <div className="rounded-2xl border border-primary/15 bg-primary/[0.06] p-5 text-xs leading-6 text-muted-foreground">
                Supplier applications are reviewed manually. A conversation or enquiry does not automatically approve a supplier or guarantee orders.
              </div>
            </div>
          </div>
        </motion.div>
      </Container>
    </section>
  );
}
