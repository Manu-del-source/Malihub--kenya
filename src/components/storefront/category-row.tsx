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
        <Link key={category.id} href={`/categories/${category.slug}`} className="group flex w-[82px] shrink-0 flex-col items-center gap-3 rounded-xl p-2 text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e6c98b]">
          <span className="flex size-14 items-center justify-center rounded-full border border-white/15 bg-[#111] text-neutral-300 transition group-hover:border-[#c6a15d]/60 group-hover:text-[#e6c98b]"><CategoryIcon index={index} /></span>
          <span className="line-clamp-2 text-xs text-neutral-400 transition group-hover:text-white">{category.name}</span>
        </Link>
      ))}
      <Link href="/marketplace?sort=newest" className="group flex w-[82px] shrink-0 flex-col items-center gap-3 rounded-xl p-2 text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e6c98b]">
        <span className="flex size-14 items-center justify-center rounded-full border border-white/15 bg-[#111] text-[#d8b775] transition group-hover:border-[#c6a15d]/60"><Star size={23} strokeWidth={1.5} /></span>
        <span className="text-xs text-neutral-400 group-hover:text-white">New Arrivals</span>
      </Link>
    </div>
  </section>;
}
