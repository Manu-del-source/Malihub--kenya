import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Camera, MapPin, Tag, Store } from "lucide-react";
import { HeroSection } from "@/components/landing/hero-section";
import { MarketplaceBrowser } from "@/components/marketplace/marketplace-browser";
import styles from "./homepage.module.css";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.malihubke.online";

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: "MaliHub Kenya",
      url: APP_URL,
      description: "A Kenyan online marketplace connecting buyers with independent sellers and product listings across Kenya.",
      logo: `${APP_URL}/icons/logo.svg`,
    },
    {
      "@type": "WebSite",
      name: "MaliHub Kenya",
      url: APP_URL,
      potentialAction: {
        "@type": "SearchAction",
        target: `${APP_URL}/marketplace?q={search_term_string}`,
        "query-input": "required name=search_term_string",
      },
    },
  ],
};

const listingDetails = [
  {
    icon: Camera,
    title: "See the item",
    description: "Review the photos and description added to each listing.",
  },
  {
    icon: Tag,
    title: "Compare the price",
    description: "Check listed prices and item condition before deciding.",
  },
  {
    icon: MapPin,
    title: "Look closer to home",
    description: "Use county information to find listings in places that suit you.",
  },
];

export default function HomePage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className={styles.homepage}>
        <HeroSection />
        <section className="border-y border-foreground/10 bg-background py-8 text-foreground sm:py-12">
          <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8">
            <MarketplaceBrowser rawParams={{}} heading="New arrivals" compact />
          </div>
        </section>

        <section className="relative overflow-hidden border-b border-foreground/10 bg-card text-foreground">
          <div className="pointer-events-none absolute -right-24 top-0 h-80 w-80 rounded-full border border-gold/10" aria-hidden />
          <div className="pointer-events-none absolute -right-10 top-12 h-56 w-56 rounded-full border border-gold/10" aria-hidden />
          <div className="mx-auto grid max-w-[1440px] gap-9 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[0.85fr_1.15fr] lg:items-center lg:gap-16 lg:px-8 lg:py-20">
            <div className="relative">
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-gold">The MaliHub experience</p>
              <h2 className="mt-3 max-w-lg font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
                A good find starts with the right details.
              </h2>
              <p className="mt-4 max-w-md text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
                Explore listings at your own pace. Compare what matters, check the item information and decide which seller to contact.
              </p>
              <Link
                href="/marketplace"
                className="mt-7 inline-flex min-h-11 items-center gap-2 rounded-full bg-gold px-5 text-sm font-semibold text-background transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-card"
              >
                Explore the marketplace <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>

            <div className="relative grid gap-3 sm:grid-cols-3">
              {listingDetails.map(({ icon: Icon, title, description }, index) => (
                <article
                  key={title}
                  className="group rounded-2xl border border-foreground/10 bg-background/80 p-5 transition duration-200 hover:-translate-y-1 hover:border-gold/35 sm:p-5"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-gold/20 bg-gold/10 text-gold transition group-hover:bg-gold/15">
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <p className="mt-6 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">0{index + 1}</p>
                  <h3 className="mt-2 font-display text-lg font-semibold">{title}</h3>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground sm:text-sm sm:leading-6">{description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-background px-4 py-10 text-foreground sm:px-6 sm:py-14 lg:px-8">
          <div className="mx-auto flex max-w-[1440px] flex-col gap-6 overflow-hidden rounded-2xl border border-gold/20 bg-[radial-gradient(ellipse_at_90%_0%,rgba(184,147,74,0.16),transparent_45%),linear-gradient(115deg,hsl(var(--card)),hsl(var(--background)))] p-6 sm:flex-row sm:items-center sm:justify-between sm:p-9 lg:p-11">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2 text-gold">
                <Store className="h-4 w-4" aria-hidden />
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em]">For independent sellers</p>
              </div>
              <h2 className="mt-3 font-display text-2xl font-semibold tracking-tight sm:text-3xl">Have something worth selling?</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
                Create a listing on MaliHub and make it easier for shoppers across Kenya to discover what you offer.
              </p>
            </div>
            <Link
              href="/seller-center"
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full border border-gold/40 bg-gold/10 px-5 text-sm font-semibold text-gold transition hover:border-gold hover:bg-gold/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
            >
              Start selling <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
