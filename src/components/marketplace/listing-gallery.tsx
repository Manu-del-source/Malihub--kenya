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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-2.5">
      <div className="relative aspect-square max-h-[min(68vw,520px)] overflow-hidden rounded-xl bg-card sm:aspect-[5/4] sm:max-h-[430px]">
        {images[active] ? (
          <Image
            src={images[active].url}
            alt={title}
            fill
            sizes="(min-width: 1024px) 56vw, 100vw"
            priority
            className="object-contain p-2 sm:p-4"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No product image available</div>
        )}

        {hasMultiple && (
          <>
            <button type="button" onClick={prev} aria-label="Previous photo" className="glass absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full sm:left-3 sm:h-9 sm:w-9">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" onClick={next} aria-label="Next photo" className="glass absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full sm:right-3 sm:h-9 sm:w-9">
              <ChevronRight className="h-4 w-4" />
            </button>
            <span className="glass-sm absolute bottom-2 right-2 rounded-full px-2.5 py-1 text-xs">{active + 1} / {images.length}</span>
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
              className={cn("relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 transition-colors sm:h-16 sm:w-16", i === active ? "border-primary/60" : "border-transparent opacity-70 hover:opacity-100")}
            >
              <Image src={img.url} alt="" fill sizes="64px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
