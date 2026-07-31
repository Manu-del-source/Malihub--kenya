"use client";

import { useEffect, useRef } from "react";
import { recordListingViewAction } from "@/app/(marketplace)/actions";

const STORAGE_KEY = "malihub-viewed-listings";

export function ViewTracker({ productId }: { productId: string }) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    try {
      const viewed = new Set<string>(JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]"));
      if (viewed.has(productId)) return;

      viewed.add(productId);
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...viewed]));
      void recordListingViewAction(productId);
    } catch {
      // sessionStorage unavailable (private browsing, etc.) — just record
      // the view without client-side dedup; the server-side dedup window
      // in recordListingView still catches logged-in repeat views.
      void recordListingViewAction(productId);
    }
  }, [productId]);

  return null;
}
