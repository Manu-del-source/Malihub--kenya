"use client";

import { useState, type ReactNode } from "react";
import { Minus, Plus } from "lucide-react";
import { AddToCartButton } from "@/components/marketplace/add-to-cart-button";
import { getUnitPriceCents, type ProductPriceTierInput } from "@/lib/pricing/product-price-tiers";
import { formatKes } from "@/utils";

export function ProductPurchaseActions({
  productId,
  status,
  stock,
  isLoggedIn,
  redirectTo,
  chatAction,
  title,
  basePriceCents,
  priceTiers,
}: {
  productId: string;
  status: string;
  stock: number;
  isLoggedIn: boolean;
  redirectTo: string;
  chatAction: ReactNode;
  title: string;
  basePriceCents: number;
  priceTiers: ProductPriceTierInput[];
}) {
  const [quantity, setQuantity] = useState(1);
  const unavailable = status !== "ACTIVE" || stock < 1;
  const selectedUnitPrice = getUnitPriceCents(basePriceCents, priceTiers, quantity);

  function decrease() {
    setQuantity((current) => Math.max(1, current - 1));
  }

  function increase() {
    setQuantity((current) => Math.min(Math.max(1, stock), current + 1));
  }

  return (
    <>
      <div className="space-y-3">\n        <p className="text-sm font-semibold text-primary">{formatKes(selectedUnitPrice)} <span className="text-xs font-normal text-muted-foreground">per unit at this quantity</span></p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="text-sm font-medium text-foreground" id="product-quantity-label">Quantity</label>
          <div className="inline-flex h-10 items-center rounded-lg border border-border bg-background">
            <button
              type="button"
              onClick={decrease}
              disabled={quantity <= 1 || unavailable}
              aria-label="Decrease quantity"
              className="flex h-10 w-10 items-center justify-center rounded-l-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Minus className="h-4 w-4" aria-hidden />
            </button>
            <output aria-labelledby="product-quantity-label" aria-live="polite" className="min-w-9 text-center font-mono text-sm font-semibold tabular-nums">
              {quantity}
            </output>
            <button
              type="button"
              onClick={increase}
              disabled={quantity >= stock || unavailable}
              aria-label="Increase quantity"
              className="flex h-10 w-10 items-center justify-center rounded-r-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <span className="text-xs text-muted-foreground">{stock > 0 ? `${stock} available` : "Out of stock"}</span>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="min-w-0 flex-1">
            <AddToCartButton
              productId={productId}
              status={status}
              stock={stock}
              isLoggedIn={isLoggedIn}
              redirectTo={redirectTo}
              quantity={quantity}
            />
          </div>
          <div className="min-w-0 flex-1">{chatAction}</div>
        </div>
      </div>

      {!unavailable && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-4 pt-3 shadow-[0_-8px_24px_rgba(0,0,0,0.14)] backdrop-blur-lg pb-[calc(env(safe-area-inset-bottom)+0.75rem)] lg:hidden">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[10px] text-muted-foreground">{title}</p>
              <p className="font-mono text-base font-bold tabular-nums text-primary">{formatKes(selectedUnitPrice)}</p>
              <p className="text-[10px] text-muted-foreground">Qty: {quantity}</p>
            </div>
            <div className="w-[48%] max-w-[13rem]">
              <AddToCartButton
                productId={productId}
                status={status}
                stock={stock}
                isLoggedIn={isLoggedIn}
                redirectTo={redirectTo}
                quantity={quantity}
                intent="checkout"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
