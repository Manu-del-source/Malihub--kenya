import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  Car, Home, Smartphone, Tv, Sofa, Shirt, Sparkles, Wheat, Briefcase, Wrench,
  WashingMachine, Dumbbell, BookOpen, Baby, PawPrint, Package, Footprints,
  type LucideIcon,
} from "lucide-react";
import { Container } from "@/components/ui/container";
import { DEFAULT_CATEGORIES } from "@/lib/constants";

const ICONS: Record<string, LucideIcon> = {
  Car, Home, Smartphone, Tv, Sofa, Shirt, Sparkles, Wheat, Briefcase, Wrench,
  WashingMachine, Dumbbell, BookOpen, Baby, PawPrint, Package, Footprints,
};

/** Compact, scannable category grid — 4 across on phones, 8 on desktop. */
export function CategoryTiles() {
  return (
    <section id="categories" aria-label="Browse categories" className="py-10 sm:py-14">
      <Container className="flex flex-col gap-5">
        <div className="flex items-end justify-between">
          <h2 className="font-display text-2xl font-medium sm:text-3xl">Shop by category</h2>
          <Link href="/marketplace" className="inline-flex items-center gap-1 text-sm font-medium text-primary">
            See all <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>

        <div className="grid grid-cols-4 gap-x-2 gap-y-5 lg:grid-cols-8">
          {DEFAULT_CATEGORIES.slice(0, 16).map((c) => {
            const Icon = ICONS[c.iconName] ?? Sparkles;
            return (
              <Link key={c.slug} href={`/categories/${c.slug}`} className="group flex flex-col items-center gap-2 text-center">
                <span className="grid aspect-square w-full place-items-center rounded-xl border border-border bg-card transition-all duration-300 ease-premium group-hover:-translate-y-0.5 group-hover:border-primary/40 group-hover:shadow-glow-primary group-active:scale-95">
                  <span className="grid h-1/2 w-1/2 place-items-center rounded-full bg-primary/10 text-primary-400">
                    <Icon className="h-1/2 w-1/2" aria-hidden />
                  </span>
                </span>
                <span className="line-clamp-2 text-[12px] font-medium leading-tight sm:text-[13px]">{c.name}</span>
              </Link>
            );
          })}
        </div>
      </Container>
    </section>
  );
}
