"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { SectionHeading } from "@/components/ui/section-heading";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { ListingCard } from "@/components/marketplace/listing-card";
import { FEATURED_LISTINGS } from "@/lib/landing-data";
import { staggerContainer, fadeUp, defaultViewport } from "@/lib/motion";

export function FeaturedListingsSection() {
  return (
    <section className="py-24 sm:py-32">
      <Container className="flex flex-col gap-14">
        <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-end">
          <SectionHeading
            align="left"
            eyebrow="Trending now"
            title="Featured listings"
            subtitle="A snapshot of what's moving fastest across the marketplace this week."
          />
          <Button variant="outline" asChild className="shrink-0">
            <Link href="/search">
              View all listings
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        </div>

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={defaultViewport}
          className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
        >
          {FEATURED_LISTINGS.map((listing) => (
            <motion.div key={listing.id} variants={fadeUp}>
              <ListingCard listing={listing} />
            </motion.div>
          ))}
        </motion.div>
      </Container>
    </section>
  );
}
