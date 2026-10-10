import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import {
  Package,
  CheckCircle2,
  FileEdit,
  Tags,
  Eye,
  MessageCircle,
  Plus,
  ShoppingCart,
  Wallet,
  UserRound,
  TriangleAlert,
} from "lucide-react";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { OrderStatusPill } from "@/components/shared/order-status-pill";
import { QuickActions, SectionHeader, StatTile } from "@/components/shell/shared/dashboard-ui";
import { EmptyState } from "@/components/shared/empty-state";
import { requireSellerAccess } from "@/lib/auth";
import { BUYER_DASHBOARD_PATH, SELLER_DASHBOARD_PATH } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { getSellerStats } from "@/services/listing-service";
import type { RecentInquiry } from "@/services/listing-service";
import { listSellerOrders } from "@/services/order-service";
import { formatKes, timeAgo } from "@/utils";

/**
 * Rendered per request — never prerendered: this route reads the session.
 *
 * Required because reading a Neon Auth session does not necessarily touch a
 * cookie (an unconfigured environment short-circuits first), so Next.js would
 * otherwise prerender this page as a static redirect to /login. The full
 * reasoning is in the layout banners and docs/auth/ARCHITECTURE.md §6.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Seller dashboard" };

const STAT_CARDS = [
  { key: "totalListings" as const, label: "Total listings", icon: Package },
  { key: "activeListings" as const, label: "Active", icon: Tags },
  { key: "drafts" as const, label: "Drafts", icon: FileEdit },
  { key: "sold" as const, label: "Sold", icon: CheckCircle2 },
  { key: "totalViews" as const, label: "Total views", icon: Eye },
];

const QUICK_LINKS = [
  { label: "Products", href: `${SELLER_DASHBOARD_PATH}/products`, icon: Package },
  { label: "Orders", href: `${SELLER_DASHBOARD_PATH}/orders`, icon: ShoppingCart },
  { label: "Sales", href: `${SELLER_DASHBOARD_PATH}/sales`, icon: Wallet },
  { label: "Profile", href: "/account", icon: UserRound },
];

export default async function SellerDashboardPage() {
  // Seller access is decided by the `sellers` row, not by `role === "SELLER"`:
  // every role can still buy, and a SELLER-role account whose row was never
  // created must not be shown an empty seller dashboard. Administrators are
  // allowed through for support, so the row lookup below still guards the
  // seller-specific query.
  const { user } = await requireSellerAccess();

  const seller = await prisma.seller.findUnique({
    where: { userId: user.id },
    select: { id: true, businessName: true, verificationStatus: true },
  });
  if (!seller) redirect(BUYER_DASHBOARD_PATH);

  const [stats, recentOrders, lowStockCount] = await Promise.all([
    getSellerStats(user.id),
    // Real orders for this seller's listings, resolved from the session's
    // user id inside the service — never from a request parameter.
    listSellerOrders(prisma, user.id),
    prisma.product.count({
      where: { sellerId: seller.id, status: "ACTIVE", quantity: { lte: 3 } },
    }),
  ]);
  const ordersPreview = (recentOrders ?? []).slice(0, 5);

  return (
    <Container className="py-6 sm:py-10">
      <div className="mb-5 flex items-center justify-between gap-4 rounded-2xl border border-primary/20 bg-gradient-to-br from-primary-50 via-card to-card p-4 sm:p-6">
        <div className="min-w-0">
          <Badge variant={seller.verificationStatus === "VERIFIED" ? "verified" : "default"}>
            {seller.verificationStatus}
          </Badge>
          <h1 className="mt-2 truncate font-display text-2xl font-medium sm:text-3xl">
            {seller.businessName}
          </h1>
          <p className="text-xs text-muted-foreground">Seller dashboard</p>
        </div>
        <Button asChild className="shrink-0">
          <Link href={`${SELLER_DASHBOARD_PATH}/listings/new`}>
            <Plus className="h-4 w-4" aria-hidden />
            <span className="hidden min-[400px]:inline">New listing</span>
          </Link>
        </Button>
      </div>

      <div className="mb-5">
        <QuickActions items={QUICK_LINKS} />
      </div>

      {/* ── First-product empty state ───────────────────────────────────── */}
      {stats.totalListings === 0 && (
        <div className="mb-8">
          <EmptyState
            icon={Package}
            title="You haven't listed any products yet."
            description="Your first listing is how buyers find you. Add a product to start selling on MaliHub."
            actionLabel="Add your first product"
            actionHref={`${SELLER_DASHBOARD_PATH}/listings/new`}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
        {STAT_CARDS.map(({ key, label, icon }) => (
          <StatTile key={key} icon={icon} label={label} value={stats[key].toLocaleString()} />
        ))}
      </div>

      {lowStockCount > 0 && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <TriangleAlert className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
          <p className="text-amber-600 dark:text-amber-400">
            {lowStockCount} active listing{lowStockCount === 1 ? " is" : "s are"} low on
            stock (3 units or fewer).{" "}
            <Link
              href={`${SELLER_DASHBOARD_PATH}/listings`}
              className="underline hover:no-underline"
            >
              Update inventory →
            </Link>
          </p>
        </div>
      )}

      {/* ── Recent orders ───────────────────────────────────────────────── */}
      <div className="mt-8">
        <SectionHeader title="Recent orders" href={`${SELLER_DASHBOARD_PATH}/orders`} linkLabel="View all" />

        {ordersPreview.length === 0 ? (
          <EmptyState
            icon={ShoppingCart}
            title="No orders yet."
            description="When buyers order your listings, the orders will appear here."
            actionLabel="Browse my listings"
            actionHref={`${SELLER_DASHBOARD_PATH}/listings`}
          />
        ) : (
          <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {ordersPreview.map((order) => (
              <div key={order.id} className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    <span className="font-mono">{order.orderNumber}</span>
                    <span className="ml-2 font-normal text-muted-foreground">
                      {order.buyer.profile?.fullName ?? "A buyer"}
                    </span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {order.items
                      .map(
                        (item) =>
                          `${item.product.title}${item.quantity > 1 ? ` ×${item.quantity}` : ""}`
                      )
                      .join(", ")}
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
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-8">
        <SectionHeader title="Recent inquiries" href="/messages" linkLabel="Open messages" />

        {stats.recentInquiries.length === 0 ? (
          <EmptyState
            icon={MessageCircle}
            title="No inquiries yet"
            description="When buyers message you about a listing, their conversations will show up here."
          />
        ) : (
          <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {stats.recentInquiries.map((inquiry: RecentInquiry) => (
              <div key={inquiry.id} className="flex items-center justify-between px-5 py-4">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {inquiry.buyer.profile?.fullName ?? "A buyer"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    About: {inquiry.product?.title ?? "a listing"}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {inquiry.lastMessageAt ? timeAgo(inquiry.lastMessageAt) : "—"}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </Container>
  );
}
