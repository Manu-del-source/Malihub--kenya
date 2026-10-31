"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BadgeCheck, ShieldCheck, RotateCcw } from "lucide-react";

export function HeroSection({ featuredImage }: { featuredImage: string | null }) {
  return (
    <section className="relative isolate mt-2 overflow-hidden rounded-2xl border border-foreground/[0.08] bg-card">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_78%_40%,rgba(184,147,74,0.15),transparent_45%)]" />
      <div className="grid items-center md:min-h-[440px] md:grid-cols-[1fr_1.05fr]">
        <div className="px-6 py-12 sm:px-10 sm:py-16 lg:px-14">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.22em] text-gold">Your marketplace. Your Kenya.</p>
          <h1 className="max-w-xl font-display text-4xl font-medium leading-[1.06] tracking-tight text-foreground sm:text-5xl lg:text-6xl">Buy &amp; Sell<br /><span className="copper-text">with Confidence.</span></h1>
          <p className="mt-5 max-w-md text-sm leading-7 text-muted-foreground sm:text-base">Discover great finds from sellers across Kenya, with secure checkout and a marketplace built around trust.</p>
          <Link href="/marketplace" className="mt-7 inline-flex min-h-12 items-center gap-3 rounded-xl bg-primary hover:bg-primary-400 px-6 text-sm font-semibold text-primary-foreground  transition hover:-translate-y-0.5  focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">Shop Now <ArrowRight size={17} /></Link>
        </div>
        <div className="relative min-h-[250px] overflow-hidden md:min-h-[440px]">
          {featuredImage ? <Image src={featuredImage} alt="Featured listing available on MaliHub" fill priority sizes="(max-width: 768px) 100vw, 52vw" className="object-cover object-center" /> : <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_65%_40%,rgba(184,147,74,.18),transparent_48%),linear-gradient(145deg,hsl(var(--card)),hsl(var(--background)))]" />}
          <div className="absolute inset-0 bg-gradient-to-r from-card via-black/10 to-black/25 md:bg-gradient-to-r md:from-card/55 md:via-transparent md:to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-card/60 to-transparent" />
        </div>
      </div>
      <div className="grid gap-4 border-t border-foreground/[0.08] px-6 py-5 sm:grid-cols-3 sm:px-10">
        {[{ icon: BadgeCheck, text: "Verified Sellers" }, { icon: ShieldCheck, text: "Secure Checkout" }, { icon: RotateCcw, text: "Clear Return Policies" }].map(({ icon: Icon, text }) => <div key={text} className="flex items-center gap-3 text-sm text-foreground/80"><Icon size={18} className="shrink-0 text-gold" />{text}</div>)}
      </div>
    </section>
  );
}
