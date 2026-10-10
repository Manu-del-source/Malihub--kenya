import Link from "next/link";
import {
  Car, Home, Smartphone, Tv, Sofa, Shirt, Sparkles, Wheat, Briefcase, Wrench,
  WashingMachine, Dumbbell, BookOpen, Baby, PawPrint, Package, Footprints,
  type LucideIcon,
} from "lucide-react";
import { DEFAULT_CATEGORIES } from "@/lib/constants";

const ICONS: Record<string, LucideIcon> = {
  Car, Home, Smartphone, Tv, Sofa, Shirt, Sparkles, Wheat, Briefcase, Wrench,
  WashingMachine, Dumbbell, BookOpen, Baby, PawPrint, Package, Footprints,
};

export function CategoryTiles() {
  return (
    <section id="categories" aria-label="Categories" className="bg-background">
      <div className="container grid grid-cols-4 gap-x-2 gap-y-4 py-5 lg:grid-cols-8">
        {DEFAULT_CATEGORIES.slice(0, 16).map((c) => {
          const Icon = ICONS[c.iconName] ?? Sparkles;
          return (
            <Link key={c.slug} href={`/categories/${c.slug}`} className="group text-center">
              <div className="grid aspect-square place-items-center rounded-lg bg-neutral-200 text-neutral-600 transition group-active:scale-95 dark:bg-muted dark:text-muted-foreground">
                <Icon className="h-1/3 w-1/3" aria-hidden />
              </div>
              <p className="mt-1.5 line-clamp-2 text-[12px] font-medium leading-tight">{c.name}</p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
