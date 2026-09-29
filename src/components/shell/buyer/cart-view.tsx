"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Minus, Plus, ShoppingCart, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { formatKes } from "@/utils";

/**
 * Buyer cart.
 *
 * Every mutation goes through the `/api/cart` route handler, which resolves
 * the buyer from the server session — no userId, price or ownership ever
 * travels in these payloads. On success the server components are re-read
 * (`router.refresh()`), so the totals shown are always recomputed from the
 * database, never from client-side arithmetic.
 */

export type CartItemDto = {
  id: string;
  productId: string;
  slug: string;
  title: string;
  imageUrl: string;
  sellerName: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  isAvailable: boolean;
  stockAvailable: number;
};

async function callCart(
  method: "PATCH" | "DELETE" | "POST",
  body: Record<string, unknown>
): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch("/api/cart", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    return { ok: false, error: payload?.error ?? "Something went wrong. Please try again." };
  }
  return { ok: true };
}

export function CartView({
  items,
  subtotalCents,
}: {
  items: CartItemDto[];
  subtotalCents: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [checkingOut, setCheckingOut] = useState(false);

  function mutate(fn: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        toast.error(result.error ?? "Something went wrong. Please try again.");
        // The listing may have changed underneath us — re-read server state.
        router.refresh();
        return;
      }
      router.refresh();
    });
  }

  function changeQuantity(item: CartItemDto, next: number) {
    if (next < 1 || next === item.quantity) return;
    mutate(() => callCart("PATCH", { productId: item.productId, quantity: next }));
  }

  function removeItem(item: CartItemDto) {
    mutate(() => callCart("DELETE", { productId: item.productId }));
  }

  async function checkout() {
    setCheckingOut(true);
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        toast.error(payload?.error ?? "Could not place your order. Please try again.");
        router.refresh();
        return;
      }
      toast.success("Order placed. Payment comes next — your order is saved.");
      router.push("/buyer/orders");
      router.refresh();
    } catch {
      toast.error("Could not place your order. Please try again.");
    } finally {
      setCheckingOut(false);
    }
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={ShoppingCart}
        title="Your cart is empty."
        description="Find something you like in the marketplace and add it to your cart."
        actionLabel="Discover products →"
        actionHref="/marketplace"
      />
    );
  }

  const unavailable = items.filter((item) => !item.isAvailable);

  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
      <div className="flex-1">
        {unavailable.length > 0 && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
            <p className="text-amber-600 dark:text-amber-400">
              {unavailable.length === 1
                ? "1 item is no longer available and will be skipped at checkout. Remove it to continue."
                : `${unavailable.length} items are no longer available and will be skipped at checkout.`}
            </p>
          </div>
        )}

        <div className="glass flex flex-col divide-y divide-border rounded-2xl">
          {items.map((item) => (
            <div key={item.id} className="flex gap-4 p-5">
              <Link
                href={`/products/${item.slug}`}
                className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-border bg-muted"
              >
                {item.imageUrl && (
                  <Image
                    src={item.imageUrl}
                    alt={item.title}
                    fill
                    sizes="80px"
                    className="object-cover"
                  />
                )}
              </Link>

              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/products/${item.slug}`}
                      className="block truncate text-sm font-medium hover:text-primary-400"
                    >
                      {item.title}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">{item.sellerName}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(item)}
                    disabled={isPending}
                    aria-label={`Remove ${item.title} from cart`}
                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>

                {!item.isAvailable ? (
                  <p className="mt-2 text-xs font-medium text-destructive">
                    No longer available
                  </p>
                ) : (
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-1 rounded-full border border-border">
                      <button
                        type="button"
                        onClick={() => changeQuantity(item, item.quantity - 1)}
                        disabled={isPending || item.quantity <= 1}
                        aria-label="Decrease quantity"
                        className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                      >
                        <Minus className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <span className="w-8 text-center font-mono text-sm tabular-nums">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => changeQuantity(item, item.quantity + 1)}
                        disabled={isPending || item.quantity >= item.stockAvailable}
                        aria-label="Increase quantity"
                        className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                    <p className="font-mono text-sm font-medium tabular-nums">
                      {formatKes(item.lineTotalCents)}
                    </p>
                  </div>
                )}
                {item.isAvailable && item.quantity >= item.stockAvailable && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    All {item.stockAvailable} available units are in your cart.
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <aside className="w-full lg:w-80">
        <div className="glass rounded-2xl p-6">
          <h2 className="font-display text-lg font-medium">Order summary</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="font-mono tabular-nums">{formatKes(subtotalCents)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Delivery</dt>
              <dd className="text-xs text-muted-foreground">Arranged with the seller</dd>
            </div>
          </dl>
          <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
            <span className="text-sm font-medium">Total</span>
            <span className="font-mono text-xl font-medium tabular-nums text-primary-400">
              {formatKes(subtotalCents)}
            </span>
          </div>

          <Button
            className="mt-5 w-full"
            onClick={checkout}
            disabled={checkingOut || isPending || subtotalCents === 0}
          >
            {checkingOut ? "Placing order…" : "Proceed to checkout"}
          </Button>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Payment is collected in a later step — your order is reserved as soon as you
            continue.
          </p>
        </div>
      </aside>
    </div>
  );
}
