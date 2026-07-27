"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Clock, TrendingUp, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DEFAULT_CATEGORIES, KENYA_COUNTIES } from "@/lib/constants";
import { RECENT_SEARCHES_SAMPLE, TRENDING_SEARCHES } from "@/lib/landing-data";
import { cn } from "@/utils";

export function HeroSearchBar() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [county, setCounty] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);

  const filteredSuggestions = useMemo(() => {
    if (!query.trim()) return null;
    const q = query.toLowerCase();
    return TRENDING_SEARCHES.filter((s) => s.toLowerCase().includes(q));
  }, [query]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (category) params.set("category", category);
    if (county) params.set("county", county);
    router.push(`/search?${params.toString()}`);
  }

  function applySuggestion(term: string) {
    setQuery(term);
    setSuggestionsOpen(false);
  }

  return (
    <div className="relative w-full max-w-3xl">
      <form
        onSubmit={handleSubmit}
        className="glass flex flex-col gap-2 rounded-2xl p-2 sm:flex-row sm:items-center sm:gap-0 sm:rounded-full"
      >
        <label htmlFor="hero-category" className="sr-only">
          Category
        </label>
        <select
          id="hero-category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-11 shrink-0 rounded-xl border-0 bg-transparent px-4 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-40 sm:rounded-full"
        >
          <option value="">All categories</option>
          {DEFAULT_CATEGORIES.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>

        <span className="hidden h-6 w-px bg-border sm:block" aria-hidden />

        <div className="relative flex flex-1 items-center gap-2 px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <label htmlFor="hero-search-input" className="sr-only">
            Search MaliHub
          </label>
          <input
            id="hero-search-input"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setSuggestionsOpen(true)}
            onBlur={() => setSuggestionsOpen(false)}
            placeholder="Search phones, cars, apartments…"
            autoComplete="off"
            className="h-11 w-full min-w-0 border-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>

        <span className="hidden h-6 w-px bg-border sm:block" aria-hidden />

        <label htmlFor="hero-county" className="sr-only">
          County
        </label>
        <div className="flex items-center gap-1.5 pl-1">
          <MapPin className="ml-2 hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" aria-hidden />
          <select
            id="hero-county"
            value={county}
            onChange={(e) => setCounty(e.target.value)}
            className="h-11 shrink-0 rounded-xl border-0 bg-transparent px-3 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-36 sm:rounded-full"
          >
            <option value="">All counties</option>
            {KENYA_COUNTIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <Button type="submit" size="lg" className="rounded-full sm:ml-1">
          Search
        </Button>
      </form>

      <AnimatePresence>
        {suggestionsOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="glass absolute inset-x-2 top-full z-10 mt-2 rounded-2xl p-4 text-left sm:inset-x-4"
          >
            {filteredSuggestions && filteredSuggestions.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {filteredSuggestions.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      onMouseDown={() => applySuggestion(s)}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-foreground/90 hover:bg-muted"
                    >
                      <Search className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-col gap-4 sm:flex-row sm:gap-8">
                <div className="flex-1">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" aria-hidden />
                    Recent
                  </p>
                  <ul className="flex flex-wrap gap-2">
                    {RECENT_SEARCHES_SAMPLE.map((s) => (
                      <li key={s}>
                        <button
                          type="button"
                          onMouseDown={() => applySuggestion(s)}
                          className="rounded-full bg-muted px-3 py-1.5 text-xs text-foreground/90 transition-colors hover:bg-primary/15 hover:text-primary-400"
                        >
                          {s}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex-1">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <TrendingUp className="h-3.5 w-3.5" aria-hidden />
                    Trending
                  </p>
                  <ul className="flex flex-wrap gap-2">
                    {TRENDING_SEARCHES.slice(0, 4).map((s) => (
                      <li key={s}>
                        <button
                          type="button"
                          onMouseDown={() => applySuggestion(s)}
                          className={cn(
                            "rounded-full bg-muted px-3 py-1.5 text-xs text-foreground/90 transition-colors hover:bg-cyan/15 hover:text-cyan"
                          )}
                        >
                          {s}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
