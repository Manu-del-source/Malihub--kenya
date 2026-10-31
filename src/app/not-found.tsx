import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Store } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page not found",
  description: "This MaliHub page could not be found. Return to the marketplace to keep exploring.",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <main className="relative isolate flex min-h-screen flex-col overflow-hidden bg-background text-foreground">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_50%_12%,rgba(200,135,69,0.16),transparent_52%)]"
      />

      <header className="mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-12">
        <Link href="/" aria-label="MaliHub homepage" className="group inline-flex items-center gap-3 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold">
          <span className="brand-mark flex h-10 w-10 items-center justify-center rounded-xl text-lg font-semibold text-foreground">M</span>
          <span className="text-lg font-semibold tracking-tight">Mali<span className="copper-text">Hub</span></span>
        </Link>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-foreground/[0.04] px-4 py-2.5 text-sm font-medium text-foreground/80 transition hover:border-gold/50 hover:bg-gold/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold"
        >
          <Store aria-hidden="true" size={16} />
          Visit marketplace
        </Link>
      </header>

      <section className="relative flex flex-1 flex-col items-center justify-center px-5 pb-16 pt-8 text-center sm:pb-20">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 -z-10 -translate-y-1/2 select-none overflow-hidden">
          <span className="block text-center text-[clamp(15rem,43vw,38rem)] font-semibold leading-[0.72] tracking-[-0.09em] text-foreground/[0.025]">404</span>
        </div>

        <div className="mb-7 flex h-14 w-14 items-center justify-center rounded-2xl border border-gold/25 bg-gold/10 text-gold shadow-[0_0_60px_rgba(200,135,69,0.12)]">
          <span aria-hidden="true" className="text-3xl leading-none">✳</span>
        </div>
        <p className="mb-4 text-xs font-semibold uppercase tracking-[0.28em] text-gold">Wrong turn</p>
        <h1 className="max-w-3xl text-balance font-display text-4xl font-medium tracking-tight sm:text-6xl lg:text-7xl">
          This page is <span className="copper-text">off the map.</span>
        </h1>
        <p className="mt-5 max-w-md text-base leading-7 text-muted-foreground sm:text-lg">
          The page you’re looking for may have moved or no longer exists. There are plenty more finds waiting on MaliHub.
        </p>
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
          <Link
            href="/"
            className="group inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-gold px-6 py-3 text-sm font-semibold text-background transition hover:bg-gold/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold"
          >
            Back to MaliHub
            <ArrowUpRight aria-hidden="true" size={17} className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </Link>
          <Link
            href="/"
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-medium text-foreground/80 transition hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold"
          >
            <ArrowLeft aria-hidden="true" size={16} />
            Explore the homepage
          </Link>
        </div>

        <div aria-hidden="true" className="relative mt-14 w-full max-w-5xl overflow-hidden rounded-3xl border border-foreground/[0.07] bg-card sm:mt-20">
          <svg viewBox="0 0 1200 270" role="presentation" className="block h-40 w-full sm:h-56 lg:h-64" preserveAspectRatio="xMidYMid slice">
            <defs>
              <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#292117" />
                <stop offset="100%" stopColor="#10100e" />
              </linearGradient>
              <linearGradient id="ridge" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#57432e" />
                <stop offset="100%" stopColor="#201d17" />
              </linearGradient>
              <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#49351f" />
                <stop offset="100%" stopColor="#151611" />
              </linearGradient>
            </defs>
            <rect width="1200" height="270" fill="url(#sky)" />
            <circle cx="875" cy="65" r="34" fill="#d49a5b" opacity=".14" />
            <circle cx="875" cy="65" r="18" fill="#e6bd8a" opacity=".45" />
            <g fill="#f0d6ae" opacity=".6">
              <circle cx="140" cy="42" r="1.5" /><circle cx="235" cy="80" r="1" /><circle cx="390" cy="37" r="1.2" />
              <circle cx="548" cy="66" r="1.4" /><circle cx="1020" cy="35" r="1.3" /><circle cx="1090" cy="91" r="1" />
            </g>
            <path d="M0 205 135 105 235 182 360 80 475 190 620 96 735 185 865 105 1010 190 1110 120 1200 180V270H0Z" fill="#28251d" />
            <path d="m0 220 160-76 115 48 170-92 145 100 160-78 125 70 150-93 175 91v80H0Z" fill="url(#ridge)" />
            <path d="M0 238q155-62 310-18t305-4 300 4 285-18v68H0Z" fill="url(#ground)" />
            <path d="M0 252q200-36 370-5t360-1 470-4" fill="none" stroke="#c88745" strokeOpacity=".35" strokeWidth="2" />
            <g fill="#d49a5b" opacity=".7">
              <circle cx="200" cy="235" r="2" /><circle cx="230" cy="245" r="1.5" /><circle cx="390" cy="233" r="1.5" />
              <circle cx="740" cy="240" r="2" /><circle cx="950" cy="230" r="1.5" /><circle cx="1035" cy="246" r="2" />
            </g>
          </svg>
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background/75 to-transparent" />
          <p className="absolute bottom-4 left-5 text-left text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground sm:left-7 sm:text-xs">Your next great find is closer than you think</p>
        </div>
      </section>

      <footer className="border-t border-foreground/[0.08] bg-background/80">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-5 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12">
          <span>© {new Date().getFullYear()} MaliHub Kenya</span>
          <span>Buy and sell across Kenya, all in one place.</span>
        </div>
      </footer>
    </main>
  );
}
