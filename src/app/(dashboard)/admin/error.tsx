"use client";

import { TriangleAlert } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";

/** Route-level error boundary for the admin area (see admin/loading.tsx for
 * the coverage rule). Shows the failure honestly; details go to the server
 * log, never into the page. */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Container className="py-16">
      <div className="glass mx-auto flex max-w-md flex-col items-center gap-4 rounded-2xl p-10 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/15 text-destructive">
          <TriangleAlert className="h-6 w-6" aria-hidden />
        </div>
        <div>
          <p className="font-display text-lg font-medium">The admin view hit an error</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {error.message || "Something went wrong while loading this page."}
          </p>
          {error.digest && (
            <p className="mt-2 font-mono text-xs text-muted-foreground">ref: {error.digest}</p>
          )}
        </div>
        <Button size="sm" onClick={reset}>
          Try again
        </Button>
      </div>
    </Container>
  );
}
