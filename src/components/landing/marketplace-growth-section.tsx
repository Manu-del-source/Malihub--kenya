"use client";

import Link from "next/link";
import { ArrowRight, Store, Truck } from "lucide-react";
import { Container } from "@/components/ui/container";

const PATHS = [
  {
    icon: Store,
    title: "Sell on MaliHub",
    description: "List your products and reach shoppers across Kenya.",
    href: "/register?role=seller",
    action: "Create seller account",
  },
  {
    icon: Truck,
    title: "Supply MaliHub",
    description: "For wholesalers, manufacturers and distributors.",
    href: "/become-a-supplier",
    action: "Explore partnership",
  },
];

export function MarketplaceGrowthSection() {
  return (
    <section className="py-8 sm:py-16">
      <Container>
        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
          {PATHS.map(({ icon: Icon, title, description, href, action }) => (
            <div key={title} className="flex items-center justify-between gap-4 rounded-2xl border border-primary/20 bg-[radial-gradient(ellipse_at_top_right,rgba(184,147,74,0.10),transparent_60%),#111111] p-4 sm:p-6">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary-400">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold sm:text-base">{title}</h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground sm:text-sm">{description}</p>
                  <Link href={href} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary-400 hover:underline sm:text-sm">
                    {action} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
