"use client";

import { useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Expand, X } from "lucide-react";
import { cn } from "@/utils";

export function ListingGallery({
  images,
  title,
}: {
  images: { url: string }[];
  title: string;
}) {
  const [active, setActive] = useState(0);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const hasMultiple = images.length > 1;

  function next() {
    setActive((i) => (i + 1) % images.length);
  }
  function prev() {
    setActive((i) => (i - 1 + images.length) % images.length);
  }

  return (
    <>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
        <div className="group relative aspect-square max-h-[min(78vw,600px)] overflow-hidden rounded-xl bg-muted/30 sm:aspect-[5/4] sm:max-h-[520px]">
          {images[active] ? (
            <Image
              src={images[active].url}
              alt={title}
              fill
              sizes="(min-width: 1024px) 56vw, 100vw"
              priority
              className="pointer-events-none object-contain p-3 sm:p-6"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No product image available</div>
          )}

          {images[active] && (
            <button
              type="button"
              onClick={() => setIsViewerOpen(true)}
              aria-label="View larger product image"
              className="absolute right-3 top-3 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border border-border/70 bg-background/90 text-foreground shadow-sm transition hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Expand className="h-4 w-4" aria-hidden />
            </button>
          )}

          {hasMultiple && (
            <>
              <button type="button" onClick={prev} aria-label="Previous photo" className="absolute left-3 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-border/70 bg-background/90 text-foreground shadow-sm transition hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:h-10 sm:w-10">
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </button>
              <button type="button" onClick={next} aria-label="Next photo" className="absolute right-3 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-border/70 bg-background/90 text-foreground shadow-sm transition hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:h-10 sm:w-10">
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
              <span className="absolute bottom-3 right-3 rounded-full bg-background/90 px-3 py-1.5 text-xs font-medium tabular-nums text-foreground shadow-sm">{active + 1} / {images.length}</span>
            </>
          )}
        </div>

        {hasMultiple && (
          <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Product photos">
            {images.map((img, i) => (
              <button
                key={img.url}
                type="button"
                onClick={() => setActive(i)}
                aria-label={`View photo ${i + 1}`}
                aria-current={i === active ? "true" : undefined}
                className={cn("relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 bg-muted/30 transition sm:h-[4.5rem] sm:w-[4.5rem]", i === active ? "border-primary" : "border-border/60 opacity-75 hover:opacity-100")}
              >
                <Image src={img.url} alt="" fill sizes="72px" className="object-cover" />
              </button>
            ))}
          </div>
        )}
        <p className="text-center text-xs text-muted-foreground">Select a photo to view it · Use the expand control for a closer look</p>
      </div>

      {isViewerOpen && images[active] && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-3 sm:p-8"
          role="dialog"
          aria-modal="true"
          aria-label={`Product image: ${title}`}
          onClick={() => setIsViewerOpen(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setIsViewerOpen(false);
            if (event.key === "ArrowRight" && hasMultiple) next();
            if (event.key === "ArrowLeft" && hasMultiple) prev();
          }}
          tabIndex={-1}
        >
          <button
            type="button"
            onClick={() => setIsViewerOpen(false)}
            aria-label="Close image viewer"
            className="absolute right-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
          {hasMultiple && (
            <>
              <button type="button" onClick={(event) => { event.stopPropagation(); prev(); }} aria-label="Previous photo" className="absolute left-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 sm:left-6">
                <ChevronLeft className="h-5 w-5" aria-hidden />
              </button>
              <button type="button" onClick={(event) => { event.stopPropagation(); next(); }} aria-label="Next photo" className="absolute right-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 sm:right-6">
                <ChevronRight className="h-5 w-5" aria-hidden />
              </button>
            </>
          )}
          <div className="relative h-full w-full max-w-6xl" onClick={(event) => event.stopPropagation()}>
            <Image src={images[active].url} alt={title} fill sizes="100vw" priority className="object-contain" />
          </div>
          {hasMultiple && <span className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1.5 text-sm tabular-nums text-white">{active + 1} / {images.length}</span>}
        </div>
      )}
    </>
  );
}
