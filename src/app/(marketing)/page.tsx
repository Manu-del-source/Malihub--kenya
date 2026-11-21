import type { Metadata } from "next";
import { MarketplaceBenefitsSection } from "@/components/landing/marketplace-benefits-section";
import { HeroSection } from "@/components/landing/hero-section";
import { MarketplaceBrowser } from "@/components/marketplace/marketplace-browser";
import styles from "./homepage.module.css";

export const metadata: Metadata = {
  title: "MaliHub Kenya — Shop products from sellers across Kenya",
  description:
    "Discover products and local listings from independent sellers across Kenya. Compare prices, explore categories and connect directly with sellers.",
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
      email: "support@malihubke.online",
      telephone: "+254****7261",
      contactPoint: {
        "@type": "ContactPoint",
        telephone: "+254****7261",
        email: "support@malihubke.online",
        contactType: "customer support",
      },
      address: {
        "@type": "PostalAddress",
        addressLocality: "Eldoret",
        addressCountry: "KE",
      },
      sameAs: ["https://www.instagram.com/malihubke/"],
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

export default async function HomePage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className={styles.homepage}>
        <HeroSection />

        <section
          aria-labelledby="latest-listings-heading"
          className="border-y border-foreground/10 bg-background py-8 text-foreground sm:py-12"
        >
          <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8">
            <MarketplaceBrowser rawParams={{}} heading="Latest listings" compact featuredCarousel />
          </div>
        </section>

        <MarketplaceBenefitsSection />
      </div>
    </>
  );
}