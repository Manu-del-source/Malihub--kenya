"use client";

import { useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/utils";

export function ListingGallery({
  images,
  title,
}: {
  images: { url: string }[];
  title: string;
}) {
  const [active, setActive] = useState(0);
  const hasMultiple = images.length > 1;

  function next() {
    setActive((i) => (i + 1) % images.length);
  }
  function prev() {
    setActive((i) => (i - 1 + images.length) % images.length);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-muted">
        {images[active] && (
          <Image
            src={images[active].url}
            alt={title}
            fill
            sizes="(min-width: 1024px) 640px, 100vw"
            priority
            className="object-cover"
          />
        )}

        {hasMultiple && (
          <>
            <button
              type="button"
              onClick={prev}
              aria-label="Previous photo"
              className="glass absolute left-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={next}
              aria-label="Next photo"
              className="glass absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <span className="glass-sm absolute bottom-3 right-3 rounded-full px-2.5 py-1 text-xs">
              {active + 1} / {images.length}
            </span>
          </>
        )}
      </div>

      {hasMultiple && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((img, i) => (
            <button
              key={img.url}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`View photo ${i + 1}`}
              aria-current={i === active}
              className={cn(
                "relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 transition-colors",
                i === active ? "border-primary/60" : "border-transparent opacity-70 hover:opacity-100"
              )}
            >
              <Image src={img.url} alt="" fill sizes="64px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
