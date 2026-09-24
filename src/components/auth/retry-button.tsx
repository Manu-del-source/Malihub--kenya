"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Client-side reload button for the controlled-failure cards on
 * /complete-profile. Reloading re-runs the server component, which re-reads
 * Neon and re-attempts the claim repair — the deterministic retry path.
 */
export function RetryButton() {
  return (
    <Button type="button" className="w-full" onClick={() => window.location.reload()}>
      <RefreshCw className="h-4 w-4" aria-hidden />
      Try again
    </Button>
  );
}
