"use client";

import { useState } from "react";
import Link from "next/link";
import {
  BadgePercent, Footprints, Smartphone, Headphones, Cable,
  Armchair, CookingPot, Sparkles, WashingMachine, Shirt,
  Laptop, Monitor, Watch, Gem, ShoppingBag, House, HeartPulse, Package,
  type LucideIcon,
} from "lucide-react";

type CategoryItem = { name: string; slug: string; icon: LucideIcon };
type CategoryGroup = { name: string; icon: LucideIcon; items: CategoryItem[] };

const groups: CategoryGroup[] = [
  { name: "Mali Featured", icon: BadgePercent, items: [
    { name: "Popular products", slug: "/marketplace?sort=most_viewed", icon: BadgePercent },
    { name: "Latest arrivals", slug: "/marketplace?sort=newest", icon: Package },
  ] },
  { name: "Shoes", icon: Footprints, items: [
    { name: "Shoes & Footwear", slug: "shoes-footwear", icon: Footprints },
  ] },
  { name: "Phones & Accessories", icon: Smartphone, items: [
    { name: "Smart Phones", slug: "phones", icon: Smartphone },
    { name: "Electronics", slug: "electronics", icon: Headphones },
  ] },
  { name: "Home & Kitchen", icon: House, items: [
    { name: "Furniture", slug: "furniture", icon: Armchair },
    { name: "Home Appliances", slug: "home-appliances", icon: CookingPot },
  ] },
  { name: "Health & Beauty", icon: HeartPulse, items: [
    { name: "Beauty", slug: "beauty", icon: Sparkles },
  ] },
  { name: "Appliances", icon: WashingMachine, items: [
    { name: "Home Appliances", slug: "home-appliances", icon: WashingMachine },
    { name: "Electronics", slug: "electronics", icon: Cable },
  ] },
  { name: "Bags", icon: ShoppingBag, items: [
    { name: "Fashion", slug: "fashion", icon: ShoppingBag },
  ] },
  { name: "Computers & Accessories", icon: Laptop, items: [
    { name: "Electronics", slug: "electronics", icon: Monitor },
  ] },
  { name: "Clothes", icon: Shirt, items: [
    { name: "Fashion", slug: "fashion", icon: Shirt },
  ] },
  { name: "Watches & Jewellery", icon: Watch, items: [
    { name: "Fashion", slug: "fashion", icon: Gem },
  ] },
];

export function CategoryBrowser() {
  const [selected, setSelected] = useState(0);
  const active = groups[selected];

  return (
    <section aria-label="Shop by category" className="grid min-h-[min(680px,calc(100svh-230px))] grid-cols-[minmax(112px,30%)_1fr] overflow-hidden rounded-xl border border-foreground/10 bg-card sm:rounded-2xl">
      <nav aria-label="Main categories" className="max-h-[680px] overflow-y-auto border-r border-foreground/10 bg-background/70">
        {groups.map((group, index) => {
          const Icon = group.icon;
          const isActive = selected === index;
          return (
            <button
              key={group.name}
              type="button"
              onClick={() => setSelected(index)}
              aria-pressed={isActive}
              className={`flex min-h-[68px] w-full items-center gap-2 border-b border-foreground/5 px-2.5 py-3 text-left text-xs transition sm:min-h-[72px] sm:gap-3 sm:px-4 sm:text-sm ${isActive ? "bg-amber-400 font-semibold text-black" : "text-foreground/85 hover:bg-amber-400/10"}`}
            >
              <Icon className="h-5 w-5 shrink-0" aria-hidden />
              <span className="leading-4">{group.name}</span>
            </button>
          );
        })}
      </nav>

      <div className="min-w-0 overflow-y-auto p-3 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="font-display text-sm font-semibold text-foreground sm:text-lg">{active.name}</h2>
          <span className="text-[10px] text-muted-foreground sm:text-xs">Explore</span>
        </div>
        <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
          {active.items.map((item) => {
            const Icon = item.icon;
            const href = item.slug.startsWith("/") ? item.slug : `/categories/${item.slug}`;
            return (
              <Link key={item.name} href={href} className="group flex min-w-0 flex-col items-center gap-2 rounded-lg p-1.5 text-center transition hover:bg-amber-400/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 sm:rounded-xl sm:p-2">
                <span className="flex aspect-square w-full max-w-[112px] items-center justify-center rounded-xl border border-foreground/10 bg-background text-amber-300 transition group-hover:border-amber-400/50 group-hover:bg-amber-400/10">
                  <Icon className="h-8 w-8 sm:h-10 sm:w-10" strokeWidth={1.5} aria-hidden />
                </span>
                <span className="line-clamp-2 text-[10px] leading-4 text-foreground/85 sm:text-xs">{item.name}</span>
              </Link>
            );
          })}
        </div>
        {active.items.length === 0 && <p className="text-sm text-muted-foreground">More categories will appear here as they become available.</p>}
      </div>
    </section>
  );
}
