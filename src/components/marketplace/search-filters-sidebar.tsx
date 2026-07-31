"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DEFAULT_CATEGORIES, KENYA_COUNTIES, PRODUCT_CONDITIONS } from "@/lib/constants";
import { kesToCents, formatKes } from "@/utils";

const selectClass =
  "h-10 w-full rounded-lg border border-border bg-background/60 px-3 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function SearchFiltersSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [minPrice, setMinPrice] = useState(searchParams.get("minPrice") ?? "");
  const [maxPrice, setMaxPrice] = useState(searchParams.get("maxPrice") ?? "");
  const [town, setTown] = useState(searchParams.get("town") ?? "");

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete("cursor");
    router.push(`${pathname}?${params.toString()}`);
  }

  function applyPriceAndTown() {
    const params = new URLSearchParams(searchParams.toString());
    if (minPrice) params.set("minPrice", String(kesToCents(Number(minPrice))));
    else params.delete("minPrice");
    if (maxPrice) params.set("maxPrice", String(kesToCents(Number(maxPrice))));
    else params.delete("maxPrice");
    if (town) params.set("town", town);
    else params.delete("town");
    params.delete("cursor");
    router.push(`${pathname}?${params.toString()}`);
  }

  const hasActiveFilters = [...searchParams.keys()].some((k) =>
    ["category", "county", "town", "condition", "minPrice", "maxPrice"].includes(k)
  );

  return (
    <aside className="flex w-full flex-col gap-6 lg:w-64 lg:shrink-0">
      <div className="flex items-center justify-between">
        <h2 className="font-medium text-foreground">Filters</h2>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={() => router.push(pathname)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
            Clear all
          </button>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="filter-category" className="text-sm text-muted-foreground">
          Category
        </label>
        <select
          id="filter-category"
          className={selectClass}
          value={searchParams.get("category") ?? ""}
          onChange={(e) => updateParam("category", e.target.value)}
        >
          <option value="">All categories</option>
          {DEFAULT_CATEGORIES.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="filter-county" className="text-sm text-muted-foreground">
          County
        </label>
        <select
          id="filter-county"
          className={selectClass}
          value={searchParams.get("county") ?? ""}
          onChange={(e) => updateParam("county", e.target.value)}
        >
          <option value="">All counties</option>
          {KENYA_COUNTIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="filter-town" className="text-sm text-muted-foreground">
          Town / area
        </label>
        <input
          id="filter-town"
          value={town}
          onChange={(e) => setTown(e.target.value)}
          onBlur={applyPriceAndTown}
          placeholder="e.g. Kilimani"
          className={selectClass}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="filter-condition" className="text-sm text-muted-foreground">
          Condition
        </label>
        <select
          id="filter-condition"
          className={selectClass}
          value={searchParams.get("condition") ?? ""}
          onChange={(e) => updateParam("condition", e.target.value)}
        >
          <option value="">Any condition</option>
          {PRODUCT_CONDITIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm text-muted-foreground">Price range (KSh)</span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)}
            onBlur={applyPriceAndTown}
            placeholder="Min"
            className={selectClass}
          />
          <span className="text-muted-foreground">–</span>
          <input
            type="number"
            inputMode="numeric"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            onBlur={applyPriceAndTown}
            placeholder="Max"
            className={selectClass}
          />
        </div>
        {(minPrice || maxPrice) && (
          <p className="text-xs text-muted-foreground">
            {minPrice ? formatKes(kesToCents(Number(minPrice))) : "Any"} –{" "}
            {maxPrice ? formatKes(kesToCents(Number(maxPrice))) : "Any"}
          </p>
        )}
      </div>

      <Button variant="secondary" onClick={applyPriceAndTown} className="w-full">
        Apply filters
      </Button>
    </aside>
  );
}
