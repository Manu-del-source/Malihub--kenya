"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

type Slide = {
  id: string;
  title: string;
  subtitle: string;
  cta: string;
  href: string;
  className: string; // gradient background
};

const SLIDES: Slide[] = [
  {
    id: "sell",
    title: "Sell fast on MaliHub",
    subtitle: "List in 2 minutes. Get paid via M-Pesa.",
    cta: "Start selling",
    href: "/register?role=seller",
    className: "from-primary to-primary-600 text-white",
  },
  {
    id: "phones",
    title: "Phones & Gadgets",
    subtitle: "Verified sellers across Kenya",
    cta: "Shop now",
    href: "/categories/phones",
    className: "from-neutral-800 to-neutral-950 text-white",
  },
  {
    id: "home",
    title: "Home & Furniture",
    subtitle: "Brand new & like-new deals",
    cta: "Shop now",
    href: "/categories/furniture",
    className: "from-accent to-emerald-900 text-white",
  },
  {
    id: "vehicles",
    title: "Cars & Vehicles",
    subtitle: "Find your next ride near you",
    cta: "Browse",
    href: "/categories/vehicles",
    className: "from-amber-400 to-primary text-neutral-900",
  },
];

export function HeroCarousel() {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  const goTo = useCallback((i: number) => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ left: (el.scrollWidth / SLIDES.length) * i, behavior: "smooth" });
  }, []);

  useEffect(() => {
    const t = setInterval(() => goTo((active + 1) % SLIDES.length), 5000);
    return () => clearInterval(t);
  }, [active, goTo]);

  return (
    <section aria-label="Promotions" className="bg-card pb-3 pt-3">
      <div
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget;
          setActive(Math.round(el.scrollLeft / (el.scrollWidth / SLIDES.length)));
        }}
        className="scrollbar-none container flex snap-x snap-mandatory gap-2 overflow-x-auto"
      >
        {SLIDES.map((s) => (
          <Link
            key={s.id}
            href={s.href}
            className={`flex aspect-[16/8] w-[82%] shrink-0 snap-start flex-col justify-end rounded-md bg-gradient-to-br p-4 sm:w-[48%] lg:w-[32%] ${s.className}`}
          >
            <p className="text-2xl font-extrabold leading-tight">{s.title}</p>
            <p className="text-sm font-medium opacity-90">{s.subtitle}</p>
            <span className="mt-2 inline-flex items-center gap-1 text-sm font-semibold">
              {s.cta} <ArrowRight className="h-4 w-4" aria-hidden />
            </span>
          </Link>
        ))}
      </div>
      <div className="mt-3 flex justify-center gap-1.5">
        {SLIDES.map((s, i) => (
          <button
            key={s.id}
            type="button"
            aria-label={`Go to slide ${i + 1}`}
            onClick={() => goTo(i)}
            className={`h-2 rounded-full border border-foreground transition-all ${
              i === active ? "w-6 bg-foreground" : "w-2 bg-card"
            }`}
          />
        ))}
      </div>
    </section>
  );
}
