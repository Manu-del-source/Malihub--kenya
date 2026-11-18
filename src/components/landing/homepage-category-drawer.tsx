"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, X } from "lucide-react";
import { DEFAULT_CATEGORIES } from "@/lib/constants";

export function HomepageCategoryDrawer() {
  const [open, setOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="homepage-category-drawer"
        className="fixed left-0 top-[42%] z-40 flex -translate-y-1/2 items-center gap-2 rounded-r-xl border border-l-0 border-primary/30 bg-card px-2 py-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground shadow-lg transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-2.5 sm:py-4 sm:text-[11px]"
        style={{ writingMode: "vertical-rl" }}
      >
        View all categories
        <ChevronRight className="h-3.5 w-3.5 rotate-90" aria-hidden />
      </button>

      {open && (
        <div className="fixed inset-0 z-[70]">
          <button
            type="button"
            aria-label="Close categories"
            onClick={() => setOpen(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-black/65 backdrop-blur-[2px]"
          />

          <aside
            id="homepage-category-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="homepage-category-heading"
            className="relative flex h-[100dvh] w-[min(88vw,360px)] max-w-full flex-col border-r border-border bg-card text-card-foreground shadow-2xl"
          >
            <div className="flex min-h-16 items-center justify-between border-b border-border px-5">
              <h2 id="homepage-category-heading" className="font-display text-lg font-semibold tracking-tight">
                Categories
              </h2>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close categories"
                className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>

            <nav aria-label="Product categories" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-2">
              <Link
                href="/marketplace"
                onClick={() => setOpen(false)}
                className="flex min-h-12 items-center justify-between border-b border-border/80 text-sm font-medium transition-colors hover:text-primary"
              >
                All categories
                <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
              </Link>

              {DEFAULT_CATEGORIES.map((category) => (
                <Link
                  key={category.slug}
                  href={`/categories/${category.slug}`}
                  onClick={() => setOpen(false)}
                  className="flex min-h-12 items-center justify-between gap-3 border-b border-border/80 text-sm text-foreground/90 transition-colors hover:pl-1 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span>{category.name}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              ))}
            </nav>

            <div className="border-t border-border p-4">
              <Link
                href="/marketplace"
                onClick={() => setOpen(false)}
                className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                View all products
                <span aria-hidden>→</span>
              </Link>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
