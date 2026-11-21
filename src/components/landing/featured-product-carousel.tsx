"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import type { ListingCardData } from "@/components/marketplace/listing-card";
import { formatKes, productDetailPath } from "@/utils";

export function FeaturedProductCarousel({ products }: { products: ListingCardData[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [touchStart, setTouchStart] = useState<number | null>(null);

  useEffect(() => {
    if (paused || products.length < 2) return;
    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % products.length);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [paused, products.length]);

  if (!products.length) return null;
  const product = products[activeIndex] ?? products[0];
  if (!product) return null;
  const previous = () => setActiveIndex((current) => (current - 1 + products.length) % products.length);
  const next = () => setActiveIndex((current) => (current + 1) % products.length);

  return (
    <section
      className="homepage-featured"
      aria-label="Featured products"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={(event) => setTouchStart(event.touches[0]?.clientX ?? null)}
      onTouchEnd={(event) => {
        if (touchStart === null) return;
        const delta = (event.changedTouches[0]?.clientX ?? touchStart) - touchStart;
        if (Math.abs(delta) > 45) {
          if (delta < 0) next();
          else previous();
        }
        setTouchStart(null);
      }}
    >
      <div className="homepage-featured__visual">
        <Link href={productDetailPath(product.slug)} className="homepage-featured__image-link" aria-label={`View ${product.title}`}>
          <Image
            key={product.id}
            src={product.imageUrl}
            alt={product.title}
            fill
            priority
            sizes="(max-width: 640px) 92vw, 680px"
            className="homepage-featured__image"
          />
        </Link>
        {products.length > 1 && (
          <>
            <button type="button" onClick={previous} className="homepage-featured__arrow homepage-featured__arrow--left" aria-label="Previous featured product">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button type="button" onClick={next} className="homepage-featured__arrow homepage-featured__arrow--right" aria-label="Next featured product">
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}
      </div>
      <div className="homepage-featured__details" aria-live="polite">
        <p className="homepage-featured__eyebrow">FEATURED FIND</p>
        <Link href={productDetailPath(product.slug)} className="homepage-featured__title">{product.title}</Link>
        <p className="homepage-featured__price">{formatKes(product.priceCents)}</p>
        <p className="homepage-featured__location"><MapPin className="h-3.5 w-3.5" />{product.county}</p>
        {products.length > 1 && (
          <div className="homepage-featured__dots" aria-label={`Product ${activeIndex + 1} of ${products.length}`}>
            {products.slice(0, 8).map((item, index) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveIndex(index)}
                aria-label={`Show featured product ${index + 1}: ${item.title}`}
                aria-current={index === activeIndex ? "true" : undefined}
                className={index === activeIndex ? "is-active" : ""}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
