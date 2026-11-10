import Link from "next/link";
import type { Metadata } from "next";
import {
  Bell,
  ChevronRight,
  Clock3,
  Heart,
  MessageCircle,
  Package,
  PackageCheck,
  RotateCcw,
  ShoppingCart,
  Star,
  Store,
  Truck,
  UserRound,
} from "lucide-react";
import { Container } from "@/components/ui/container";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCartSummary } from "@/services/cart-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your account" };

const ROLE_LABEL: Record<string, string> = {
  BUYER: "Buyer",
  SELLER: "Seller",
  ADMIN: "Administrator",
  SUPER_ADMIN: "Super admin",
};

export default async function AccountPage() {
  const { user } = await requireUser();

  const [
    profile,
    seller,
    cartSummary,
    wishlistCount,
    orderCounts,
    toReviewCount,
    protectionCaseCount,
    listingCount,
  ] = await Promise.all([
    prisma.profile.findUnique({
      where: { userId: user.id },
      select: { fullName: true, avatarUrl: true, county: true, onboarded: true, createdAt: true },
    }),
    prisma.seller.findUnique({
      where: { userId: user.id },
      select: { businessName: true, verificationStatus: true, county: true, slug: true },
    }),
    getCartSummary(prisma, user.id),
    prisma.wishlist.count({ where: { userId: user.id } }),
    prisma.order.groupBy({
      by: ["status"],
      where: { buyerId: user.id },
      _count: { _all: true },
    }),
    prisma.order.count({
      where: {
        buyerId: user.id,
        status: { in: ["DELIVERED", "COMPLETED"] },
        reviews: { none: { authorId: user.id } },
      },
    }),
    prisma.buyerProtectionCase.count({
      where: { buyerId: user.id, status: { in: ["OPEN", "UNDER_REVIEW"] } },
    }),
    prisma.product.count({ where: { ownerId: user.id, status: { not: "REMOVED" } } }),
  ]);

  const counts = Object.fromEntries(orderCounts.map((row) => [row.status, row._count._all]));
  const count = (statuses: string[]) =>
    statuses.reduce((total, status) => total + (counts[status] ?? 0), 0);
  const memberSince = profile?.createdAt?.toLocaleDateString("en-KE", {
    month: "long",
    year: "numeric",
  });
  const displayName = profile?.fullName?.trim() || "Your account";
  const initial = displayName[0]?.toUpperCase() ?? user.email[0]?.toUpperCase() ?? "M";

  const orderShortcuts = [
    { label: "Unpaid", count: count(["PENDING"]), icon: Package, href: "/buyer/orders" },
    { label: "To be shipped", count: count(["CONFIRMED", "PAID"]), icon: PackageCheck, href: "/buyer/orders" },
    { label: "Shipped", count: count(["SHIPPED"]), icon: Truck, href: "/buyer/orders" },
    { label: "To be reviewed", count: toReviewCount, icon: Star, href: "/buyer/orders" },
    { label: "Returns / refunds", count: protectionCaseCount, icon: RotateCcw, href: "/buyer/orders" },
  ];

  const services = [
    { label: "Wishlist", detail: `${wishlistCount} saved items`, href: "/buyer/wishlist", icon: Heart },
    { label: "Notifications", detail: "Order and account updates", href: "/notifications", icon: Bell },
    { label: "Messages", detail: "Your conversations", href: "/messages", icon: MessageCircle },
    { label: "Recently viewed", detail: "Continue browsing", href: "/buyer", icon: Clock3 },
    { label: "My orders", detail: "Track your purchases", href: "/buyer/orders", icon: Package },
    { label: "Profile", detail: "Personal information", href: "/complete-profile", icon: UserRound },
    ...(seller
      ? [{ label: "Seller Centre", detail: seller.businessName, href: "/seller-center", icon: Store }]
      : []),
  ];

  return (
    <Container className="max-w-5xl py-5 pb-24 sm:py-8 md:pb-10">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-300">MaliHub account</p>
          <h1 className="mt-1 font-display text-2xl font-semibold sm:text-3xl">My account</h1>
        </div>
        <Link
          href="/complete-profile"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition hover:border-primary/50 hover:text-primary-300"
          aria-label="Edit profile"
          title="Edit profile"
        >
          <UserRound className="h-5 w-5" aria-hidden />
        </Link>
      </div>

      <section className="relative overflow-hidden rounded-2xl border border-primary/20 bg-[radial-gradient(ellipse_at_top_right,hsl(var(--primary)/0.18),transparent_55%),linear-gradient(125deg,#111111,#080808)] p-5 shadow-xl sm:p-7">
        <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full border border-primary/10" aria-hidden />
        <div className="pointer-events-none absolute -right-2 -top-8 h-32 w-32 rounded-full border border-primary/10" aria-hidden />
        <div className="relative flex min-w-0 items-center gap-4">
          <div className="flex h-[68px] w-[68px] shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-primary/50 bg-secondary text-2xl font-semibold text-primary-200 shadow-lg">
            {profile?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : initial}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-xl font-semibold text-white sm:text-2xl">{displayName}</h2>
            <p className="mt-0.5 truncate text-sm text-white/65">{user.email}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="primary">{ROLE_LABEL[user.role] ?? user.role}</Badge>
              {seller && (
                <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] text-white/75">
                  Seller · {seller.verificationStatus.toLowerCase().replaceAll("_", " ")}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="relative mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/10 pt-4 text-xs text-white/60">
          <span>{profile?.county || seller?.county || "Kenya"}</span>
          {memberSince && <span>Member since {memberSince}</span>}
          <span>{profile?.onboarded ? "Profile complete" : "Profile incomplete"}</span>
        </div>
      </section>

      <section className="mt-5 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between px-4 pb-2 pt-4 sm:px-5">
          <h2 className="font-display text-lg font-semibold">My orders</h2>
          <Link href="/buyer/orders" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary-300">
            View all <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        <div className="grid grid-cols-5 divide-x divide-border px-1 pb-4 pt-3">
          {orderShortcuts.map(({ label, count: itemCount, icon: Icon, href }) => (
            <Link key={label} href={href} className="group flex min-w-0 flex-col items-center gap-2 px-1 py-2 text-center transition-colors hover:text-primary-300">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary-300 transition-colors group-hover:bg-primary/20 sm:h-11 sm:w-11">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <span className="font-mono text-lg font-semibold tabular-nums">{itemCount}</span>
              <span className="min-h-8 text-[10px] leading-tight text-muted-foreground sm:text-xs">{label}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-5 rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">My activity</h2>
          <Link href="/buyer" className="text-xs text-muted-foreground hover:text-primary-300">View dashboard</Link>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:gap-4">
          <Link href="/buyer/cart" className="rounded-xl bg-muted/70 p-3 text-center transition hover:bg-muted">
            <ShoppingCart className="mx-auto h-5 w-5 text-primary-300" aria-hidden />
            <p className="mt-2 font-mono text-xl font-semibold tabular-nums">{cartSummary.itemCount}</p>
            <p className="text-xs text-muted-foreground">Cart items</p>
          </Link>
          <Link href="/buyer/wishlist" className="rounded-xl bg-muted/70 p-3 text-center transition hover:bg-muted">
            <Heart className="mx-auto h-5 w-5 text-primary-300" aria-hidden />
            <p className="mt-2 font-mono text-xl font-semibold tabular-nums">{wishlistCount}</p>
            <p className="text-xs text-muted-foreground">Wishlist</p>
          </Link>
          <Link href="/buyer/orders" className="rounded-xl bg-muted/70 p-3 text-center transition hover:bg-muted">
            <Package className="mx-auto h-5 w-5 text-primary-300" aria-hidden />
            <p className="mt-2 font-mono text-xl font-semibold tabular-nums">{orderCounts.reduce((total, row) => total + row._count._all, 0)}</p>
            <p className="text-xs text-muted-foreground">Orders</p>
          </Link>
        </div>
      </section>

      {seller && (
        <section className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-primary/20 bg-card p-4 sm:p-5">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Your store</p>
            <h2 className="mt-1 truncate font-display text-lg font-semibold">{seller.businessName}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{listingCount} listing{listingCount === 1 ? "" : "s"} · {seller.verificationStatus.toLowerCase().replaceAll("_", " ")}</p>
          </div>
          <Link href="/seller-center" className="rounded-full border border-primary/40 px-4 py-2 text-sm font-medium text-primary-300 transition hover:bg-primary/10">Open Seller Centre</Link>
        </section>
      )}

      <section className="mt-5 rounded-2xl border border-border bg-card p-4 sm:p-5">
        <h2 className="mb-3 font-display text-lg font-semibold">My services</h2>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-3 sm:gap-3">
          {services.map(({ label, detail, href, icon: Icon }) => (
            <Link key={label} href={href} className="group flex min-h-28 flex-col items-center justify-center rounded-xl border border-transparent px-2 py-3 text-center transition hover:border-primary/25 hover:bg-muted/60">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-foreground/85 group-hover:text-primary-300">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <span className="mt-2 text-xs font-medium leading-tight">{label}</span>
              <span className="mt-1 line-clamp-1 text-[10px] text-muted-foreground">{detail}</span>
            </Link>
          ))}
        </div>
      </section>
    </Container>
  );
}
