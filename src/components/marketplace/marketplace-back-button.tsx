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
      className="mb-4 inline-flex h-10 items-center gap-2 rounded-lg border border-[#3A3A3A] bg-[#141414] px-4 text-sm font-semibold text-[#F5F5F5] transition hover:border-[#C98A4A] hover:bg-[#1C1C1C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C98A4A]"
      aria-label="Go back to the previous page"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Back
    </button>
  );
}
