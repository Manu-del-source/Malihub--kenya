import Link from "next/link";
import { OrderStatusPill } from "@/components/shared/order-status-pill";
import type { Metadata } from "next";
import {
  Search,
  ShoppingCart,
  Heart,
  Package,
  Clock,
  Bookmark,
  ArrowRight,
  Eye,
} from "lucide-react";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/shared/empty-state";
import { ListingCard, type ListingCardData } from "@/components/marketplace/listing-card";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCartSummary } from "@/services/cart-service";
import { DEFAULT_CATEGORIES } from "@/lib/constants";
import { formatKes, timeAgo } from "@/utils";
import type { Prisma } from "@prisma/client";

/**
 * Rendered per request — never prerendered: this route reads the session.
 *
 * Required because reading a Neon Auth session does not necessarily touch a
 * cookie (an unconfigured environment short-circuits first), so Next.js would
 * otherwise prerender this page as a static redirect to /login. The full
 * reasoning is in the layout banners and docs/auth/ARCHITECTURE.md §6.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Your dashboard" };

const CARD_INCLUDE = {
  images: { orderBy: { sortOrder: "asc" as const }, take: 1 },
  seller: { select: { businessName: true, verificationStatus: true } },
} satisfies Prisma.ProductInclude;

type CardProduct = Prisma.ProductGetPayload<{ include: typeof CARD_INCLUDE }>;

function toCard(product: CardProduct, isFavorited = false): ListingCardData {
  return {
    id: product.id,
    slug: product.slug,
    title: product.title,
    priceCents: product.priceCents,
    isNegotiable: product.isNegotiable,
    imageUrl: product.images[0]?.url ?? "",
    county: product.county,
    postedAt: (product.publishedAt ?? product.createdAt).toISOString(),
    isVerifiedSeller: product.seller.verificationStatus === "VERIFIED",
    sellerName: product.seller.businessName,
    favoriteCount: product.favoriteCount,
    condition: product.condition,
    isFavorited,
  };
}

export default async function BuyerDashboardPage() {
  const { user } = await requireUser();

  const [
    profile,
    cartSummary,
    wishlistCount,
    wishlistItems,
    orderCount,
    recentOrders,
    recentViews,
    savedSearches,
    discover,
  ] = await Promise.all([
    prisma.profile.findUnique({
      where: { userId: user.id },
      select: { fullName: true },
    }),
    getCartSummary(prisma, user.id),
    prisma.wishlist.count({ where: { userId: user.id } }),
    prisma.wishlist.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 4,
      include: { product: { include: CARD_INCLUDE } },
    }),
    prisma.order.count({ where: { buyerId: user.id } }),
    prisma.order.findMany({
      where: { buyerId: user.id },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: {
        items: {
          take: 2,
          select: { quantity: true, product: { select: { title: true } } },
        },
        seller: { select: { businessName: true } },
      },
    }),
    // Recently viewed comes from the real ListingView trail the product page
    // records (listing-service.recordListingView) — not a client-side guess.
    prisma.listingView.findMany({
      where: { viewerId: user.id, product: { status: "ACTIVE" } },
      orderBy: { createdAt: "desc" },
      take: 24,
      select: { product: { include: CARD_INCLUDE } },
    }),
    prisma.savedSearch.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { id: true, label: true, query: true },
    }),
    prisma.product.findMany({
      where: { status: "ACTIVE" },
      orderBy: { publishedAt: "desc" },
      take: 4,
      include: CARD_INCLUDE,
    }),
  ]);

  const firstName = profile?.fullName?.trim().split(/\s+/)[0] ?? user.email.split("@")[0];

  // Dedupe the view trail: the last N views usually repeat the same few
  // listings, and a card grid should show each once.
  const viewedCards: ListingCardData[] = [];
  const seenViewed = new Set<string>();
  for (const view of recentViews) {
    if (seenViewed.has(view.product.id)) continue;
    seenViewed.add(view.product.id);
    viewedCards.push(toCard(view.product));
    if (viewedCards.length >= 6) break;
  }

  const wishCards: ListingCardData[] = wishlistItems.map((w) =>
    toCard(w.product, true)
  );

  const tiles = [
    {
      label: "Cart",
      href: "/buyer/cart",
      icon: ShoppingCart,
      count: cartSummary.itemCount,
      detail:
        cartSummary.itemCount > 0 ? formatKes(cartSummary.subtotalCents) : "Empty",
    },
    {
      label: "Wishlist",
      href: "/buyer/wishlist",
      icon: Heart,
      count: wishlistCount,
      detail: wishlistCount > 0 ? "Saved listings" : "Nothing saved yet",
    },
    {
      label: "Orders",
      href: "/buyer/orders",
      icon: Package,
      count: orderCount,
      detail: orderCount > 0 ? "Track & review" : "No orders yet",
    },
  ];

  return (
    <Container className="py-10">
      {/* ── Welcome + search ─────────────────────────────────────────────── */}
      <div className="glass rounded-2xl p-8">
        <p className="text-sm text-muted-foreground">Welcome back</p>
        <h1 className="mt-1 font-display text-3xl font-medium">Welcome, {firstName}</h1>
        <form action="/marketplace" method="get" className="mt-5 flex max-w-xl gap-2">
          <label htmlFor="dashboard-search" className="sr-only">
            Search products
          </label>
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              id="dashboard-search"
              name="q"
              type="search"
              placeholder="Search products..."
              className="h-11 w-full rounded-full border border-border bg-background/60 pl-10 pr-4 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50"
            />
          </div>
          <button
            type="submit"
            className="rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Search
          </button>
        </form>
      </div>

      {/* ── Cart / Wishlist / Orders tiles ───────────────────────────────── */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {tiles.map(({ label, href, icon: Icon, count, detail }) => (
          <Link
            key={label}
            href={href}
            className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40"
          >
            <div className="flex items-center justify-between">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary-400">
                <Icon className="h-4 w-4" aria-hidden />
              </div>
              <ArrowRight
                className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </div>
            <p className="mt-3 font-mono text-2xl font-medium tabular-nums">{count}</p>
            <p className="text-sm font-medium">{label}</p>
            <p className="text-xs text-muted-foreground">{detail}</p>
          </Link>
        ))}
      </div>

      {/* ── Recent orders ────────────────────────────────────────────────── */}
      <section className="mt-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-medium">Recent orders</h2>
          {orderCount > 0 && (
            <Link
              href="/buyer/orders"
              className="text-sm text-primary-400 hover:underline"
            >
              View all orders
            </Link>
          )}
        </div>

        {recentOrders.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No orders yet."
            description="When you buy something, your orders and their status will appear here."
            actionLabel="Discover products →"
            actionHref="/marketplace"
          />
        ) : (
          <div className="glass flex flex-col divide-y divide-border rounded-2xl">
            {recentOrders.map((order) => (
              <Link
                key={order.id}
                href={`/buyer/orders/${order.id}`}
                className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-muted/40"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {order.orderNumber}
                    <span className="ml-2 font-normal text-muted-foreground">
                      {order.seller.businessName}
                    </span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {order.items
                      .map((item) => `${item.product.title}${item.quantity > 1 ? ` ×${item.quantity}` : ""}`)
                      .join(", ")}
                    {order.items.length > 0 ? "" : "No items"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-sm font-medium tabular-nums">
                    {formatKes(order.totalCents)}
                  </p>
                  <div className="mt-1 flex items-center justify-end gap-2">
                    <OrderStatusPill status={order.status} />
                    <span className="text-xs text-muted-foreground">
                      {timeAgo(order.createdAt)}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ── Discover ─────────────────────────────────────────────────────── */}
      <section className="mt-10">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-medium">Discover products</h2>
          <Link href="/marketplace" className="text-sm text-primary-400 hover:underline">
            Browse marketplace →
          </Link>
        </div>

        <div className="mb-5 flex flex-wrap gap-2">
          {DEFAULT_CATEGORIES.slice(0, 10).map((category) => (
            <Link
              key={category.slug}
              href={`/marketplace?category=${category.slug}`}
              className="rounded-full border border-border px-3.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              {category.name}
            </Link>
          ))}
        </div>

        {discover.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No listings yet"
            description="The marketplace is just getting started — check back soon for fresh listings."
            actionLabel="Open marketplace"
            actionHref="/marketplace"
          />
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {discover.map((product) => (
              <ListingCard key={product.id} listing={toCard(product)} />
            ))}
          </div>
        )}
      </section>

      {/* ── Wishlist preview ─────────────────────────────────────────────── */}
      {wishCards.length > 0 && (
        <section className="mt-10">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-xl font-medium">
              Your wishlist{" "}
              <span className="text-sm font-normal text-muted-foreground">
                ({wishlistCount} saved)
              </span>
            </h2>
            <Link
              href="/buyer/wishlist"
              className="text-sm text-primary-400 hover:underline"
            >
              View wishlist
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {wishCards.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        </section>
      )}

      {/* ── Recently viewed ──────────────────────────────────────────────── */}
      {viewedCards.length > 0 && (
        <section className="mt-10">
          <div className="mb-4 flex items-center gap-2">
            <Eye className="h-4 w-4 text-muted-foreground" aria-hidden />
            <h2 className="font-display text-xl font-medium">Recently viewed</h2>
          </div>
          <div className="grid grid-cols-2 gap-5 lg:grid-cols-3 xl:grid-cols-6">
            {viewedCards.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        </section>
      )}

      {/* ── Saved searches ───────────────────────────────────────────────── */}
      {savedSearches.length > 0 && (
        <section className="mt-10">
          <div className="mb-4 flex items-center gap-2">
            <Bookmark className="h-4 w-4 text-muted-foreground" aria-hidden />
            <h2 className="font-display text-xl font-medium">Saved searches</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {savedSearches.map((search) => (
              <Link
                key={search.id}
                href={`/marketplace${search.query ? `?q=${encodeURIComponent(search.query)}` : ""}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                <Clock className="h-3.5 w-3.5" aria-hidden />
                {search.label}
              </Link>
            ))}
          </div>
        </section>
      )}
    </Container>
  );
}
