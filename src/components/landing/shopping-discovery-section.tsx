"use client";

import Link from "next/link";
import { ArrowRight, BadgeCheck, MapPin, Store, Tag } from "lucide-react";
import { Container } from "@/components/ui/container";
import { DEFAULT_CATEGORIES } from "@/lib/constants";

const SHOPPING_PROMISES = [
  { icon: BadgeCheck, title: "Seller verification", copy: "Look for verification details on seller profiles." },
  { icon: MapPin, title: "Shop across Kenya", copy: "Use location details to find relevant listings." },
  { icon: Tag, title: "Clear listing details", copy: "Compare prices, condition and photos before deciding." },
];

export function ShoppingDiscoverySection() {
  return (
    <section aria-labelledby="shopping-discovery-title" className="border-y border-border/70 bg-card/40 py-10 sm:py-14">
      <Container className="flex flex-col gap-8">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-400">Your next find starts here</p>
            <h2 id="shopping-discovery-title" className="mt-2 font-display text-2xl font-medium tracking-tight sm:text-3xl">
              Shop what matters to you
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Browse real listings by category, compare details, and choose what works for you.
            </p>
          </div>
          <Link href="/marketplace" className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-primary-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Explore all listings <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {DEFAULT_CATEGORIES.slice(0, 5).map((category) => (
            <Link
              key={category.slug}
              href={`/categories/${category.slug}`}
              className="group flex min-h-20 items-center justify-between gap-3 rounded-xl border border-border bg-background p-4 transition hover:border-primary/40 hover:bg-primary/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="text-sm font-medium leading-5 group-hover:text-primary-400">{category.name}</span>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary-400" aria-hidden />
            </Link>
          ))}
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {SHOPPING_PROMISES.map(({ icon: Icon, title, copy }) => (
            <div key={title} className="flex items-start gap-3 rounded-xl bg-muted/40 p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/[0.08] text-primary-400">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <h3 className="text-sm font-medium">{title}</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{copy}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col justify-between gap-4 rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/[0.10] via-card to-card p-5 sm:flex-row sm:items-center sm:p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary-400">
              <Store className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <h3 className="font-medium">Have something to sell?</h3>
              <p className="mt-1 text-sm text-muted-foreground">Create a listing and reach shoppers across Kenya.</p>
            </div>
          </div>
          <Link href="/register?role=seller" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Start selling <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </Container>
    </section>
  );
}
