import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCart } from "@/services/cart-service";
import { CartView, type CartItemDto } from "@/components/shell/buyer/cart-view";

/**
 * Rendered per request — never prerendered: this route reads the session.
 *
 * Required because reading a Neon Auth session does not necessarily touch a
 * cookie (an unconfigured environment short-circuits first), so Next.js would
 * otherwise prerender this page as a static redirect to /login. The full
 * reasoning is in the layout banners and docs/auth/ARCHITECTURE.md §6.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Your cart" };

export default async function BuyerCartPage() {
  const { user } = await requireUser();

  const cart = await getCart(prisma, user.id);

  const items: CartItemDto[] = cart.items.map((line) => ({
    id: line.id,
    productId: line.productId,
    slug: line.product.slug,
    title: line.product.title,
    imageUrl: line.product.images[0]?.url ?? "",
    sellerName: line.product.seller.businessName,
    quantity: line.quantity,
    unitPriceCents: line.unitPriceCents,
    lineTotalCents: line.lineTotalCents,
    isAvailable: line.isAvailable,
    stockAvailable: line.stockAvailable,
  }));

  return (
    <Container className="py-10">
      <h1 className="mb-1 font-display text-3xl font-medium">Your cart</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        {items.length === 0
          ? "Nothing here yet"
          : `${items.length} item${items.length === 1 ? "" : "s"} ready to check out`}
      </p>

      <CartView items={items} subtotalCents={cart.subtotalCents} />
    </Container>
  );
}
