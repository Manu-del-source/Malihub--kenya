"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  BadgePercent, Footprints, Smartphone, Headphones, Cable, Armchair, CookingPot,
  Sparkles, WashingMachine, Shirt, Laptop, Monitor, Watch, Gem, ShoppingBag,
  Package, ChevronRight, Flame, type LucideIcon,
} from "lucide-react";

type Item = { name: string; href: string; icon: LucideIcon };
type Section = { title: string; viewAll?: string; items: Item[] };
type Group = { id: string; name: string; banner: { title: string; subtitle: string }; sections: Section[] };

const cat = (slug: string) => `/categories/${slug}`;

const groups: Group[] = [
  {
    id: "mali-featured", name: "Mali Featured",
    banner: { title: "Mali Deals", subtitle: "Hot picks from sellers across Kenya" },
    sections: [
      { title: "Featured", items: [
        { name: "Popular products", href: "/marketplace?sort=most_viewed", icon: BadgePercent },
        { name: "Latest arrivals", href: "/marketplace?sort=newest", icon: Package },
      ] },
      { title: "Top categories", viewAll: "/marketplace?sort=newest", items: [
        { name: "Smart Phones", href: cat("phones"), icon: Smartphone },
        { name: "Electronics", href: cat("electronics"), icon: Headphones },
        { name: "Fashion", href: cat("fashion"), icon: Shirt },
        { name: "Beauty", href: cat("beauty"), icon: Sparkles },
        { name: "Furniture", href: cat("furniture"), icon: Armchair },
        { name: "Home Appliances", href: cat("home-appliances"), icon: CookingPot },
      ] },
    ],
  },
  { id: "shoes", name: "Shoes", banner: { title: "Step Up", subtitle: "Sneakers, sandals & more" }, sections: [
    { title: "Shoes", viewAll: cat("shoes-footwear"), items: [{ name: "Shoes & Footwear", href: cat("shoes-footwear"), icon: Footprints }] },
  ] },
  { id: "phones-accessories", name: "Phones & Accessories", banner: { title: "Phones & Gadgets", subtitle: "Smartphones and accessories" }, sections: [
    { title: "Phones", viewAll: cat("phones"), items: [{ name: "Smart Phones", href: cat("phones"), icon: Smartphone }] },
    { title: "Accessories", viewAll: cat("electronics"), items: [{ name: "Electronics", href: cat("electronics"), icon: Headphones }] },
  ] },
  { id: "home-kitchen", name: "Home & Kitchen", banner: { title: "Home Essentials", subtitle: "Furniture & kitchen finds" }, sections: [
    { title: "Home & Kitchen", viewAll: cat("furniture"), items: [
      { name: "Furniture", href: cat("furniture"), icon: Armchair },
      { name: "Home Appliances", href: cat("home-appliances"), icon: CookingPot },
    ] },
  ] },
  { id: "health-beauty", name: "Health & Beauty", banner: { title: "Glow Up", subtitle: "Beauty and personal care" }, sections: [
    { title: "Beauty", viewAll: cat("beauty"), items: [{ name: "Beauty", href: cat("beauty"), icon: Sparkles }] },
  ] },
  { id: "appliances", name: "Appliances", banner: { title: "Appliances", subtitle: "Power up your home" }, sections: [
    { title: "Appliances", viewAll: cat("home-appliances"), items: [
      { name: "Home Appliances", href: cat("home-appliances"), icon: WashingMachine },
      { name: "Electronics", href: cat("electronics"), icon: Cable },
    ] },
  ] },
  { id: "bags", name: "Bags", banner: { title: "Bags", subtitle: "Carry it in style" }, sections: [
    { title: "Bags", viewAll: cat("fashion"), items: [{ name: "Fashion", href: cat("fashion"), icon: ShoppingBag }] },
  ] },
  { id: "computers-accessories", name: "Computers & Accessories", banner: { title: "Work & Play", subtitle: "Laptops and accessories" }, sections: [
    { title: "Computers", viewAll: cat("electronics"), items: [
      { name: "Laptops & PCs", href: cat("electronics"), icon: Laptop },
      { name: "Monitors", href: cat("electronics"), icon: Monitor },
    ] },
  ] },
  { id: "clothes", name: "Clothes", banner: { title: "Fresh Fits", subtitle: "Trending fashion" }, sections: [
    { title: "Clothes", viewAll: cat("fashion"), items: [{ name: "Fashion", href: cat("fashion"), icon: Shirt }] },
  ] },
  { id: "watches-jewellery", name: "Watches & Jewellery", banner: { title: "Shine On", subtitle: "Watches & jewellery" }, sections: [
    { title: "Watches & Jewellery", viewAll: cat("fashion"), items: [
      { name: "Watches", href: cat("fashion"), icon: Watch },
      { name: "Jewellery", href: cat("fashion"), icon: Gem },
    ] },
  ] },
];

export function CategoryBrowser() {
  const [selectedId, setSelectedId] = useState("mali-featured");
  const paneRef = useRef<HTMLDivElement>(null);
  const active = groups.find((g) => g.id === selectedId);

  useEffect(() => {
    paneRef.current?.scrollTo({ top: 0 });
  }, [selectedId]);

  if (!active) return null;

  return (
    <section
      aria-label="Shop by category"
      className="pwa-category-browser grid h-[calc(100svh-120px)] min-h-[480px] grid-cols-[92px_1fr] overflow-hidden rounded-xl border border-foreground/10 bg-card sm:grid-cols-[180px_1fr] sm:rounded-2xl"
    >
      {/* Left rail */}
      <nav aria-label="Main categories" role="tablist" aria-orientation="vertical" className="pwa-category-nav overflow-y-auto overscroll-contain bg-background/80 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {groups.map((group) => {
          const isActive = group.id === selectedId;
          return (
            <button
              key={group.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setSelectedId(group.id)}
              className={`pwa-category-tab relative flex min-h-[56px] w-full items-center px-3 py-3 text-left text-[12px] leading-4 transition-colors sm:min-h-[60px] sm:px-4 sm:text-sm ${
                isActive ? "bg-card font-semibold text-amber-400" : "text-foreground/70 hover:text-foreground"
              }`}
            >
              {isActive && <span aria-hidden className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r bg-amber-400" />}
              <span className="line-clamp-2">{group.name}</span>
            </button>
          );
        })}
      </nav>

      {/* Right pane */}
      <div ref={paneRef} role="tabpanel" className="pwa-category-panel min-w-0 overflow-y-auto overscroll-contain bg-card px-3 pb-6 pt-3 sm:px-5 sm:pt-4">
        <Link
          href="/marketplace?sort=newest"
          className="pwa-category-banner relative mb-4 flex h-[84px] items-center justify-between overflow-hidden rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 px-4 text-black sm:h-[110px] sm:px-6"
        >
          <div className="min-w-0">
            <p className="font-display text-base font-bold leading-tight sm:text-2xl">{active.banner.title}</p>
            <p className="mt-0.5 text-[11px] font-medium text-black/70 sm:text-sm">{active.banner.subtitle}</p>
          </div>
          <Flame className="h-10 w-10 shrink-0 text-black/20 sm:h-14 sm:w-14" aria-hidden />
        </Link>

        {active.sections.map((section) => (
          <div key={section.title} className="mb-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="truncate text-[13px] font-semibold text-foreground sm:text-base">{section.title}</h2>
              {section.viewAll && (
                <Link href={section.viewAll} className="inline-flex shrink-0 items-center text-[11px] text-muted-foreground hover:text-amber-400 sm:text-xs">
                  View all <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              )}
            </div>
            <div className="pwa-category-items grid grid-cols-3 gap-x-2 gap-y-4 sm:grid-cols-4 sm:gap-x-4">
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link key={item.name} href={item.href} className="pwa-category-item group flex min-w-0 flex-col items-center gap-1.5 text-center focus-visible:outline-none">
                    <span className="flex aspect-square w-full max-w-[84px] items-center justify-center rounded-full border border-foreground/10 bg-background text-amber-400 transition group-hover:border-amber-400/60 group-hover:bg-amber-400/10 group-focus-visible:ring-2 group-focus-visible:ring-amber-400 sm:max-w-[96px]">
                      <Icon className="h-7 w-7 sm:h-8 sm:w-8" strokeWidth={1.5} aria-hidden />
                    </span>
                    <span className="line-clamp-2 w-full text-[11px] leading-4 text-foreground/85 sm:text-xs">{item.name}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
