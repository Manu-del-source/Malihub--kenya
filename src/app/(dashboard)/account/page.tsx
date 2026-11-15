import Link from "next/link";
import type { Metadata } from "next";
import {
  Bell,
  ChevronRight,
  Clock3,
  Heart,
  LogOut,
  MapPin,
  Package,
  PackageCheck,
  RotateCcw,
  ShieldCheck,
  Star,
  Store,
  Truck,
  UserRound,
} from "lucide-react";
import { signOutAction } from "@/app/(auth)/actions";
import { Container } from "@/components/ui/container";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
  const displayName = profile?.fullName?.trim() || "Your account";
  const initial = displayName[0]?.toUpperCase() ?? user.email[0]?.toUpperCase() ?? "M";

  const orderShortcuts = [
    { label: "Unpaid", count: count(["PENDING"]), icon: Package,  href: "/buyer/orders?status=unpaid" },
    { label: "To be shipped", count: count(["CONFIRMED", "PAID"]), icon: PackageCheck, href: "/buyer/orders?status=to-ship" },
    { label: "Shipped", count: count(["SHIPPED"]), icon: Truck, href: "/buyer/orders?status=shipped" },
    { label: "To be reviewed", count: toReviewCount, icon: Star, href: "/buyer/orders?status=to-review" },
    { label: "Returns / refunds", count: protectionCaseCount, icon: RotateCcw, href: "/buyer/orders?status=returns" },
  ];

  // Cart and Messages are bottom-bar tabs and the order strip above covers
  // purchases — none of them are repeated here.
  const services = [
    { label: "Wishlist", detail: `${wishlistCount} saved`, href: "/buyer/wishlist", icon: Heart },
    { label: "Notifications", detail: "Order and account updates", href: "/notifications", icon: Bell },
    { label: "Addresses", detail: "Delivery destinations", href: "/account/addresses", icon: MapPin },
    { label: "Recently viewed", detail: "Continue browsing", href: "/buyer", icon: Clock3 },
    { label: "Profile", detail: profile?.onboarded ? "Personal information" : "Finish setting up", href: "/complete-profile", icon: UserRound },
  ];

  const isAdmin = user.role === "ADMIN" || user.role === "SUPER_ADMIN";
  const roleLinks = [
    ...(isAdmin
      ? [{ label: "Admin dashboard", detail: "Orders, revenue, sellers and moderation", href: "/admin", icon: ShieldCheck }]
      : []),
    ...(seller
      ? [{
          label: "Seller Centre",
          detail: `${seller.businessName} · ${listingCount} listing${listingCount === 1 ? "" : "s"}`,
          href: "/seller-center",
          icon: Store,
        }]
      : []),
  ];

  const rowClass =
    "flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary";

  return (
    <Container className="max-w-2xl space-y-4 py-4 pb-24 md:py-8 md:pb-10">
      <h1 className="font-display text-2xl font-semibold">Account</h1>

      <Link href="/complete-profile" className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-muted/40">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-primary/40 bg-secondary text-xl font-semibold text-primary-200">
          {profile?.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : initial}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-lg font-semibold">{displayName}</span>
          <span className="block truncate text-sm text-muted-foreground">{user.email}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge variant="primary">{ROLE_LABEL[user.role] ?? user.role}</Badge>
            {!profile?.onboarded && <span className="text-xs text-amber-400">Profile incomplete</span>}
          </span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
      </Link>

      {roleLinks.length > 0 && (
        <section aria-label="Your workspaces" className="overflow-hidden rounded-2xl border border-primary/30 bg-card">
          <ul className="divide-y divide-border">
            {roleLinks.map(({ label, detail, href, icon: Icon }) => (
              <li key={label}>
                <Link href={href} className={rowClass}>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary-300">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{detail}</span>
                  </span>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="My orders" className="rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between px-4 pt-4">
          <h2 className="font-display text-base font-semibold">My orders</h2>
          <Link href="/buyer/orders" className="inline-flex min-h-8 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary-300">
            View all <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        <ul className="grid grid-cols-5 gap-1 px-2 pb-3 pt-2">
          {orderShortcuts.map(({ label, count: itemCount, icon: Icon, href }) => (
            <li key={label}>
              <Link href={href} className="group flex min-w-0 flex-col items-center gap-1 rounded-xl px-1 py-2 text-center transition-colors hover:bg-muted/60">
                <span className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary-300">
                  <Icon className="h-5 w-5" aria-hidden />
                  {itemCount > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-primary px-1.5 text-center font-mono text-[11px] font-semibold leading-5 text-primary-foreground">
                      {itemCount}
                    </span>
                  )}
                </span>
                <span className="text-[11px] leading-tight text-muted-foreground">{label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Shortcuts" className="overflow-hidden rounded-2xl border border-border bg-card">
        <ul className="divide-y divide-border">
          {services.map(({ label, detail, href, icon: Icon }) => (
            <li key={label}>
              <Link href={href} className={rowClass}>
                <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="flex-1 text-sm font-medium">{label}</span>
                <span className="truncate text-xs text-muted-foreground">{detail}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <form action={signOutAction}>
        <button
          type="submit"
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-red-400/20 bg-card text-sm font-medium text-red-300 transition hover:bg-red-500/10"
        >
          <LogOut className="h-4 w-4" aria-hidden />
          Sign out
        </button>
      </form>
    </Container>
  );
}
