import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function PromoBanner({ imageUrl }: { imageUrl: string | null }) {
  return <section className="relative isolate overflow-hidden rounded-2xl border border-white/10 bg-[#111]">
    {imageUrl && <Image src={imageUrl} alt="" fill sizes="100vw" className="-z-20 object-cover object-center" />}
    <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[#0a0a0a] via-[#0a0a0a]/90 to-[#0a0a0a]/25" />
    <div className="max-w-xl px-6 py-12 sm:px-10 sm:py-16">
      <p className="text-xs uppercase tracking-[0.22em] text-[#d8b775]">Discover something special</p>
      <h2 className="mt-4 font-display text-3xl leading-tight text-white sm:text-4xl">Great Finds.<br />Everyday Value.</h2>
      <p className="mt-3 max-w-sm text-sm leading-6 text-neutral-400">Explore fresh listings and offers from merchants across Kenya.</p>
      <Link href="/marketplace" className="mt-6 inline-flex items-center gap-3 rounded-xl bg-primary hover:bg-primary-400 px-5 py-3 text-sm font-semibold text-primary-foreground ">Explore Listings <ArrowRight size={16} /></Link>
    </div>
  </section>;
}
