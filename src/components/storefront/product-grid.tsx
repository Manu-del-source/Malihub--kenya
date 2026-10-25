"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, BadgeCheck, MapPin, Star } from "lucide-react";

type Product = { id: string; title: string; slug: string; priceCents: number; county: string; condition: string; imageUrl: string | null; categoryName: string; categorySlug: string; sellerName: string; sellerVerified: boolean; rating: number; ratingCount: number };
const price = (cents: number) => new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(cents / 100);

export function ProductGrid({ products }: { products: Product[] }) {
  return <section aria-labelledby="best-sellers-heading">
    <div className="mb-5 flex items-end justify-between gap-4">
      <div><p className="text-xs uppercase tracking-[0.2em] text-[#c6a15d]">Picked for you</p><h2 id="best-sellers-heading" className="mt-2 font-display text-2xl text-white sm:text-3xl">Featured Finds</h2></div>
      <Link href="/marketplace" className="inline-flex shrink-0 items-center gap-2 text-sm text-[#e6c98b] hover:text-white">View All <ArrowUpRight size={15} /></Link>
    </div>
    {products.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
      {products.map((product) => <article key={product.id} className="group relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#111] transition duration-300 hover:-translate-y-1 hover:border-[#c6a15d]/40 hover:shadow-[0_12px_40px_rgba(184,147,74,0.08)]">
        <Link href={`/products/${product.slug}`} className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e6c98b]" aria-label={`View ${product.title}`}>
          <div className="relative aspect-square overflow-hidden bg-[#171717]">
            {product.imageUrl ? <Image src={product.imageUrl} alt={product.title} fill sizes="(max-width: 640px) 46vw, (max-width: 1024px) 30vw, 240px" className="object-cover transition duration-500 group-hover:scale-[1.04]" /> : <div className="flex h-full items-center justify-center text-xs text-neutral-500">Image coming soon</div>}
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
            {product.sellerVerified && <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-black/70 px-2 py-1 text-[10px] font-medium text-[#e6c98b]"><BadgeCheck size={12} /> Verified</span>}
          </div>
          <div className="space-y-2 p-3 sm:p-4">
            <div className="flex items-center gap-1.5 text-xs text-[#e6c98b]">{product.ratingCount > 0 ? <><Star size={12} fill="currentColor" /><span>{product.rating.toFixed(1)}</span><span className="text-neutral-500">({product.ratingCount})</span></> : <span className="text-neutral-500">New listing</span>}</div>
            <h3 className="line-clamp-2 min-h-10 text-sm font-medium text-white sm:text-base">{product.title}</h3>
            <p className="flex items-center gap-1 truncate text-xs text-neutral-500"><MapPin size={12} />{product.county} · {product.categoryName}</p>
          </div>
        </Link>
        <div className="flex items-center justify-between gap-2 px-3 pb-4 sm:px-4">
          <p className="text-sm font-semibold text-white sm:text-base">{price(product.priceCents)}</p>
          <Link href={`/products/${product.slug}`} aria-label={`View ${product.title} purchase options`} className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 text-[#e6c98b] transition hover:border-[#c6a15d]/50 hover:bg-[#c6a15d]/10"><ArrowUpRight size={16} /></Link>
        </div>
      </article>)}
    </div> : <div className="rounded-2xl border border-white/10 bg-[#111] p-8 text-sm text-neutral-400">New listings are on the way. Please check back soon.</div>}
  </section>;
}
