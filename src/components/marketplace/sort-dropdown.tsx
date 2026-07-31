"use client";

import { ArrowUpDown } from "lucide-react";

const SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "price_asc", label: "Price: Low to High" },
  { value: "price_desc", label: "Price: High to Low" },
  { value: "most_viewed", label: "Most viewed" },
] as const;

export function SortDropdown({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative">
      <ArrowUpDown className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Sort listings"
        className="h-10 rounded-full border border-border bg-background/60 py-0 pl-9 pr-8 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {SORT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
