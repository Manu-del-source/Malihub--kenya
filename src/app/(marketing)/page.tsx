import type { Metadata } from "next";
import { HeroSection } from "@/components/landing/hero-section";
import { CategoriesSection } from "@/components/landing/categories-section";
import { FeaturedListingsSection } from "@/components/landing/featured-listings-section";
import { WhyMaliHubSection } from "@/components/landing/why-malihub-section";
import { StatsSection } from "@/components/landing/stats-section";
import { SellerCtaSection } from "@/components/landing/seller-cta-section";
import { TestimonialsSection } from "@/components/landing/testimonials-section";
import { FaqSection } from "@/components/landing/faq-section";
import { NewsletterSection } from "@/components/landing/newsletter-section";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://malihub.co.ke";

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: "MaliHub Kenya",
      url: APP_URL,
      logo: `${APP_URL}/icons/logo.png`,
      sameAs: [
        "https://facebook.com/malihub",
        "https://twitter.com/malihub",
        "https://instagram.com/malihub",
      ],
    },
    {
      "@type": "WebSite",
      name: "MaliHub Kenya",
      url: APP_URL,
      potentialAction: {
        "@type": "SearchAction",
        target: `${APP_URL}/search?q={search_term_string}`,
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
      <CategoriesSection />
      <FeaturedListingsSection />
      <WhyMaliHubSection />
      <StatsSection />
      <SellerCtaSection />
      <TestimonialsSection />
      <FaqSection />
      <NewsletterSection />
    </>
  );
}
