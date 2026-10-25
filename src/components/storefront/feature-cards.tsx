import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

type Product = { id: string; title: string; slug: string; imageUrl: string | null; categoryName: string; categorySlug: string; priceCents: number };
export function FeatureCards({ products }: { products: Product[] }) {
  const defaults = [
    { label: "FEATURED", title: "Discover something special", copy: "Explore current listings from sellers across Kenya.", href: "/marketplace" },
    { label: "SHOP BY CATEGORY", title: "Find what you need", copy: "Browse listings by category and compare your options.", href: "/marketplace" },
    { label: "FRESH FINDS", title: "New listings, new possibilities", copy: "See what's recently listed on MaliHub.", href: "/marketplace?sort=newest" },
  ];
  return <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {defaults.map((item, i) => {
      const product = products[i];
      return <article key={item.title} className="group relative isolate min-h-[230px] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#111] transition hover:-translate-y-1 hover:border-[#c6a15d]/40">
        {product?.imageUrl && <Image src={product.imageUrl} alt="" fill sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw" className="-z-20 object-cover transition duration-500 group-hover:scale-105" />}
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-black/90 via-black/65 to-black/15" />
        <div className="flex min-h-[230px] max-w-[88%] flex-col items-start justify-end p-6">
          <span className="rounded bg-[#e6c98b] px-2 py-1 text-[10px] font-bold tracking-wide text-[#17130b]">{item.label}</span>
          <h3 className="mt-4 font-display text-2xl text-white">{product ? product.title : item.title}</h3>
          <p className="mt-2 text-sm leading-6 text-neutral-300">{product ? `Explore ${product.categoryName.toLowerCase()} listings from MaliHub sellers.` : item.copy}</p>
          <Link href={product ? `/products/${product.slug}` : item.href} className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-[#e6c98b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e6c98b]">Explore <ArrowUpRight size={16} /></Link>
        </div>
      </article>;
    })}
  </section>;
}
