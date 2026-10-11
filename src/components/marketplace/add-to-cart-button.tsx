"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShoppingCart, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * "Add to cart" for a listing.
 *
 * The POST to `/api/cart` carries only the productId (+ quantity 1) — the
 * buyer identity, product existence, availability and stock caps are all
 * re-validated server-side from the session, so this component is purely
 * presentation: nothing here is trusted.
 */
export function AddToCartButton({
  productId,
  status,
  stock,
  isLoggedIn,
  redirectTo,
}: {
  productId: string;
  status: string;
  stock: number;
  isLoggedIn: boolean;
  redirectTo: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [added, setAdded] = useState(false);

  const isActive = status === "ACTIVE";
  const soldOut = !isActive || stock < 1;

  if (!isLoggedIn) {
    return (
      <Button asChild className="w-full" size="lg">
        <Link href={`/login?redirectTo=${encodeURIComponent(redirectTo)}`}>
          <ShoppingCart className="h-4 w-4" aria-hidden />
          Sign in to buy
        </Link>
      </Button>
    );
  }

  if (soldOut) {
    return (
      <Button className="w-full" size="lg" disabled>
        {status === "SOLD" ? "Sold out" : "Unavailable"}
      </Button>
    );
  }

  function handleAdd() {
    startTransition(async () => {
      try {
        const response = await fetch("/api/cart", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId, quantity: 1 }),
        });
        const payload = await response.json().catch(() => null);

        if (response.status === 401) {
          toast.error("Sign in to add items to your cart.");
          router.push(`/login?redirectTo=${encodeURIComponent(redirectTo)}`);
          return;
        }
        if (!response.ok || !payload?.success) {
          toast.error(payload?.error ?? "Could not add to cart. Please try again.");
          return;
        }

        setAdded(true);
        toast.success("Added to cart");
        router.refresh();
        setTimeout(() => setAdded(false), 2000);
      } catch {
        toast.error("Could not add to cart. Please try again.");
      }
    });
  }

  return (
    <Button className="w-full" size="lg" onClick={handleAdd} disabled={isPending}>
      {added ? (
        <>
          <Check className="h-4 w-4" aria-hidden />
          Added
        </>
      ) : (
        <>
          <ShoppingCart className="h-4 w-4" aria-hidden />
          {isPending ? "Adding…" : "Add to cart"}
        </>
      )}
    </Button>
  );
}
