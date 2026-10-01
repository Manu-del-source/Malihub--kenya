import type { Metadata } from "next";
import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/shared/empty-state";
import { CheckoutView } from "@/components/shell/buyer/checkout-view";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCart } from "@/services/cart-service";
import { buildCheckoutSummary } from "@/lib/payments/checkout-summary";

/**
 * `/checkout` — the canonical buyer checkout screen.
 *
 * ─── Server-authoritative by construction ───────────────────────────────────
 * The page reads the session (`requireUser()`), then the buyer's cart from the
 * DATABASE via the same `getCart` service the cart page uses. Every price,
 * quantity, line total and seller shown comes from that read; the client never
 * supplies one, and the order that checkout later creates re-reads them again
 * inside the checkout transaction. `/checkout` is also in
 * `PROTECTED_PREFIXES`, so middleware already gated this request before the
 * page re-checked it — unauthenticated visitors are redirected with a
 * `redirectTo`, not rendered an empty shell.
 *
 * ─── Opening checkout reserves NOTHING ──────────────────────────────────────
 * No order is created here, no stock is decremented, no cart row is touched.
 * The order is created only when the buyer presses "Pay … with M-Pesa" on this
 * screen (see `checkout-view.tsx` → `POST /api/orders`). A buyer who opens
 * checkout and changes their mind leaves the cart exactly as it was.
 *
 * ─── Multi-seller carts ─────────────────────────────────────────────────────
 * `checkoutCart` creates one order per seller, and the summary is grouped the
 * same way so the buyer sees the split before paying. The payment stage then
 * collects each order separately (one M-Pesa prompt per order, never one
 * prompt charged against several orders).
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Checkout" };

export default async function CheckoutPage() {
  const { user } = await requireUser();

  const [cart, profile] = await Promise.all([
    getCart(prisma, user.id),
    prisma.profile.findUnique({
      where: { userId: user.id },
      select: { fullName: true },
    }),
  ]);

  const summary = buildCheckoutSummary(cart.items);

  if (summary.itemCount === 0) {
    return (
      <Container className="py-10">
        <h1 className="mb-1 font-display text-3xl font-medium">Checkout</h1>
        <p className="mb-8 text-sm text-muted-foreground">Nothing to check out yet</p>
        <EmptyState
          icon={ShoppingCart}
          title="Your cart is empty."
          description="Add something from the marketplace to check out. If you just placed an order, it is waiting for payment on your orders page."
          actionLabel="Discover products →"
          actionHref="/marketplace"
        />
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link href="/buyer/orders" className="text-primary-400 hover:underline">
            View your orders →
          </Link>
        </p>
      </Container>
    );
  }

  return (
    <Container className="py-10">
      <h1 className="mb-1 font-display text-3xl font-medium">Checkout</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Review your order, then pay securely with M-Pesa.
      </p>

      <CheckoutView
        summary={summary}
        buyer={{
          name: profile?.fullName ?? null,
          email: user.email,
          phone: user.phone ?? null,
        }}
      />
    </Container>
  );
}
