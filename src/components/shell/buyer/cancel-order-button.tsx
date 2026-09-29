"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * "Cancel order" for a buyer's own unpaid order.
 *
 * Only rendered while the order is `PENDING` — the state machine permits
 * `PENDING → CANCELLED` and nothing else, so the control is not shown for an
 * order that has been paid or already cancelled.
 *
 * Like every other buyer mutation in this app, the caller sends **no** ids,
 * roles or statuses. The order id is in the URL the browser already knows, and
 * the identity is the session. A forged body cannot cancel anything because
 * the route reads nothing from it.
 *
 * The request is confirmed first: cancellation is destructive (it releases
 * reserved stock and ends the order), so a single mis-click should not be
 * enough. The second click on an already-cancelled order is answered 409 by
 * the service, and this surfaces that as a plain message rather than a crash.
 */
export function CancelOrderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function handleClick() {
    if (!confirming) {
      setConfirming(true);
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch(`/api/orders/${orderId}/cancel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });

        if (response.ok) {
          const body = (await response.json()) as {
            data?: { restoredUnits?: number };
          };
          const units = body.data?.restoredUnits ?? 0;
          toast.success(
            units > 0
              ? `Order cancelled. ${units} unit${units === 1 ? "" : "s"} went back into stock.`
              : "Order cancelled."
          );
          router.refresh();
          return;
        }

        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        toast.error(body?.error ?? "We couldn't cancel that order.");
      } catch {
        toast.error("We couldn't reach the server. Please try again.");
      } finally {
        setConfirming(false);
      }
    });
  }

  return (
    <div className="space-y-2">
      <Button
        variant={confirming ? "primary" : "outline"}
        size="sm"
        onClick={handleClick}
        disabled={isPending}
      >
        <XCircle className="h-4 w-4" aria-hidden />
        {isPending
          ? "Cancelling…"
          : confirming
            ? "Yes, cancel this order"
            : "Cancel order"}
      </Button>
      {confirming && !isPending && (
        <p className="text-xs text-muted-foreground">
          This ends the order and returns its items to the seller&apos;s stock. It can
          not be undone.
        </p>
      )}
    </div>
  );
}
