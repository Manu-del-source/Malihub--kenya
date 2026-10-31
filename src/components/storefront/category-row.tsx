import Link from "next/link";
import { House, Smartphone, Shirt, Sparkles, Armchair, Dumbbell, Shapes, Star } from "lucide-react";

type Category = { id: string; name: string; slug: string; iconName: string | null; imageUrl: string | null };

function CategoryIcon({ index }: { index: number }) {
  const props = { size: 23, strokeWidth: 1.5 };
  switch (index % 7) {
    case 0: return <Shapes {...props} />;
    case 1: return <Smartphone {...props} />;
    case 2: return <Shirt {...props} />;
    case 3: return <House {...props} />;
    case 4: return <Sparkles {...props} />;
    case 5: return <Armchair {...props} />;
    default: return <Dumbbell {...props} />;
  }
}

export function CategoryRow({ categories }: { categories: Category[] }) {
  return <section aria-label="Shop by category" className="py-1">
    <div className="flex gap-4 overflow-x-auto pb-3 [scrollbar-width:thin] [scrollbar-color:#50432a_transparent] sm:justify-between">
      {categories.map((category, index) => (
        <Link key={category.id} href={`/categories/${category.slug}`} className="group flex w-[82px] shrink-0 flex-col items-center gap-3 rounded-xl p-2 text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold">
          <span className="flex size-14 items-center justify-center rounded-full border border-foreground/15 bg-card text-foreground/80 transition group-hover:border-gold/60 group-hover:text-gold"><CategoryIcon index={index} /></span>
          <span className="line-clamp-2 text-xs text-muted-foreground transition group-hover:text-foreground">{category.name}</span>
        </Link>
      ))}
      <Link href="/marketplace?sort=newest" className="group flex w-[82px] shrink-0 flex-col items-center gap-3 rounded-xl p-2 text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold">
        <span className="flex size-14 items-center justify-center rounded-full border border-foreground/15 bg-card text-gold transition group-hover:border-gold/60"><Star size={23} strokeWidth={1.5} /></span>
        <span className="text-xs text-muted-foreground group-hover:text-foreground">New Arrivals</span>
      </Link>
    </div>
  </section>;
}
