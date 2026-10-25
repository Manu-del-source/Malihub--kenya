import type { Metadata } from "next";
import { HeroSection } from "@/components/landing/hero-section";
import { ShoppingDiscoverySection } from "@/components/landing/shopping-discovery-section";
import { CategoriesSection } from "@/components/landing/categories-section";
import { WhyMaliHubSection } from "@/components/landing/why-malihub-section";
import { SellerCtaSection } from "@/components/landing/seller-cta-section";
import { FaqSection } from "@/components/landing/faq-section";

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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <HeroSection />
      <ShoppingDiscoverySection />
      <CategoriesSection />
      <WhyMaliHubSection />
      <SellerCtaSection />
      <FaqSection />
    </>
  );
}
