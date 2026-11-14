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
 * The order is created only when the buyer confirms delivery details and
 * continues to payment (see `checkout-view.tsx` → `POST /api/orders`). A buyer who opens
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

  const [cart, addresses] = await Promise.all([
    getCart(prisma, user.id),
    prisma.deliveryAddress.findMany({
      where: { userId: user.id },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true, label: true, recipientName: true, phone: true, county: true,
        subCounty: true, town: true, area: true, building: true, landmark: true,
        isDefault: true,
      },
    }),
  ]);

  const summary = buildCheckoutSummary(cart.items);

  if (summary.itemCount === 0) {
    return (
      <Container className="py-6 sm:py-10">
        <h1 className="mb-1 font-display text-2xl font-medium sm:text-3xl">Checkout</h1>
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
    <Container className="py-6 sm:py-10">
      <h1 className="mb-1 font-display text-2xl font-medium sm:text-3xl">Checkout</h1>
      <p className="mb-5 text-sm text-muted-foreground sm:mb-8">
        Choose where to receive your order and pay securely.
      </p>

      <CheckoutView
        summary={summary}
        addresses={addresses}
        initialAddressId={addresses.find((address) => address.isDefault)?.id ?? addresses[0]?.id ?? null}
      />
    </Container>
  );
}
