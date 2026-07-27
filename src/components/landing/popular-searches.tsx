"use client";

import Link from "next/link";
import { POPULAR_SEARCHES } from "@/lib/landing-data";

export function PopularSearches() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
      <span className="text-muted-foreground">Popular:</span>
      {POPULAR_SEARCHES.map((term) => (
        <Link
          key={term}
          href={`/search?q=${encodeURIComponent(term)}`}
          className="rounded-full border border-border/80 px-3 py-1 text-foreground/80 transition-colors hover:border-primary/40 hover:text-primary-400"
        >
          {term}
        </Link>
      ))}
    </div>
  );
}
