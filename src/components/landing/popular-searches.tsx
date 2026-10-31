"use client";

import Link from "next/link";
import { POPULAR_SEARCHES } from "@/lib/landing-data";

export function PopularSearches() {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="mr-1 text-muted-foreground">Try:</span>
      {POPULAR_SEARCHES.slice(0, 4).map((term) => (
        <Link
          key={term}
          href={`/marketplace?q=${encodeURIComponent(term)}`}
          className="rounded-full px-2 py-1 text-foreground/75 underline decoration-border underline-offset-4 transition-colors hover:text-primary-400 hover:decoration-primary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {term}
        </Link>
      ))}
    </div>
  );
}
