import type { Metadata } from "next";
import { HeroSection } from "@/components/landing/hero-section";
import { MarketplaceBrowser } from "@/components/marketplace/marketplace-browser";
import styles from "./homepage.module.css";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://malihubke.online";

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: "MaliHub Kenya",
      url: APP_URL,
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
      </div>
    </>
  );
}
