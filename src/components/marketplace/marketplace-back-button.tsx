"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

export function MarketplaceBackButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push("/");
      }}
      className="mb-4 inline-flex h-10 items-center gap-2 rounded-lg border border-[#3A3A3A] bg-card px-4 text-sm font-semibold text-foreground transition hover:border-gold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
      aria-label="Go back to the previous page"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Back
    </button>
  );
}
