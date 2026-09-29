import Link from "next/link";
import type { Metadata } from "next";
import {
  UserRound,
  ShieldCheck,
  Package,
  Heart,
  ShoppingCart,
  Store,
  LayoutDashboard,
  ExternalLink,
} from "lucide-react";
import { Container } from "@/components/ui/container";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCartSummary } from "@/services/cart-service";
import { StartSellingButton } from "@/components/shell/buyer/start-selling-button";

/**
 * Shared profile / account area — one screen both roles land on.
 *
 * Rendered per request — never prerendered: this route reads the session
 * (same Neon Auth reasoning as every protected route: docs/auth/ARCHITECTURE.md §6).
 */
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

  const [profile, seller, cartSummary, wishlistCount, orderCount, listingCount] =
    await Promise.all([
      prisma.profile.findUnique({
        where: { userId: user.id },
        select: {
          fullName: true,
          avatarUrl: true,
          county: true,
          onboarded: true,
          createdAt: true,
        },
      }),
      prisma.seller.findUnique({
        where: { userId: user.id },
        select: {
          businessName: true,
          verificationStatus: true,
          county: true,
          slug: true,
        },
      }),
      getCartSummary(prisma, user.id),
      prisma.wishlist.count({ where: { userId: user.id } }),
      prisma.order.count({ where: { buyerId: user.id } }),
      prisma.product.count({
        where: { ownerId: user.id, status: { not: "REMOVED" } },
      }),
    ]);

  const memberSince = profile?.createdAt?.toLocaleDateString("en-KE", {
    month: "long",
    year: "numeric",
  });

  return (
    <Container className="py-10">
      <h1 className="mb-1 font-display text-3xl font-medium">Account</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Your profile, roles and activity — shared across buying and selling.
      </p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
        {/* ── Profile ─────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-6">
          <section className="glass rounded-2xl p-6">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-primary-400 to-secondary text-xl font-semibold text-primary-foreground">
                {profile?.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={profile.avatarUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  (profile?.fullName?.trim()?.[0] ?? user.email[0]?.toUpperCase() ?? "?")
                )}
              </div>
              <div className="min-w-0">
                <h2 className="truncate font-display text-xl font-medium">
                  {profile?.fullName || "Your account"}
                </h2>
                <p className="truncate text-sm text-muted-foreground">{user.email}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge variant="primary">{ROLE_LABEL[user.role] ?? user.role}</Badge>
                  {seller && (
                    <Badge
                      variant={
                        seller.verificationStatus === "VERIFIED" ? "verified" : "default"
                      }
                    >
                      {seller.verificationStatus === "VERIFIED" && (
                        <ShieldCheck className="h-3 w-3" aria-hidden />
                      )}
                      Seller {seller.verificationStatus.toLowerCase()}
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            <dl className="mt-6 grid grid-cols-1 gap-x-8 gap-y-3 border-t border-border pt-5 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Phone</dt>
                <dd className="text-right">{user.phone ?? "Not added"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">County</dt>
                <dd className="text-right">{profile?.county ?? "Not set"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Member since</dt>
                <dd className="text-right">{memberSince ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Profile status</dt>
                <dd className="text-right">
                  {profile?.onboarded ? "Complete" : "Incomplete"}
                  {!profile?.onboarded && (
                    <Link
                      href="/complete-profile"
                      className="ml-2 text-primary-400 hover:underline"
                    >
                      Finish setup
                    </Link>
                  )}
                </dd>
              </div>
            </dl>
          </section>

          {/* ── Seller setup ────────────────────────────────────────── */}
          {!seller && (
            <section className="rounded-2xl border border-border bg-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="font-display text-lg font-medium">Start selling</h2>
                  <p className="mt-1 max-w-md text-sm text-muted-foreground">
                    Turn your account into a seller shop — you&apos;ll get product
                    management, orders and sales screens. Only accounts that opt in get
                    seller access.
                  </p>
                </div>
                {profile?.onboarded ? (
                  <StartSellingButton />
                ) : (
                  <Link
                    href="/complete-profile"
                    className="text-sm text-primary-400 hover:underline"
                  >
                    Finish your profile first →
                  </Link>
                )}
              </div>
            </section>
          )}

          {seller && (
            <section className="rounded-2xl border border-border bg-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="font-display text-lg font-medium">{seller.businessName}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Your shop is live at{" "}
                    <span className="font-mono text-xs">/sellers/{seller.slug}</span>
                    {seller.county && ` · ${seller.county}`}
                  </p>
                </div>
                <Link
                  href="/seller"
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  <LayoutDashboard className="h-4 w-4" aria-hidden />
                  Seller dashboard
                </Link>
              </div>
            </section>
          )}

          {/* ── Quick links ─────────────────────────────────────────── */}
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Link
              href="/buyer"
              className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-sm transition-colors hover:border-primary/40"
            >
              <LayoutDashboard className="h-4 w-4 text-muted-foreground" aria-hidden />
              Buyer dashboard
            </Link>
            <Link
              href="/buyer/orders"
              className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-sm transition-colors hover:border-primary/40"
            >
              <Package className="h-4 w-4 text-muted-foreground" aria-hidden />
              Orders
            </Link>
            <Link
              href="/marketplace"
              className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-sm transition-colors hover:border-primary/40"
            >
              <ExternalLink className="h-4 w-4 text-muted-foreground" aria-hidden />
              Marketplace
            </Link>
          </section>
        </div>

        {/* ── Activity summary ───────────────────────────────────────── */}
        <aside>
          <section className="glass rounded-2xl p-6">
            <div className="flex items-center gap-2">
              <UserRound className="h-4 w-4 text-muted-foreground" aria-hidden />
              <h2 className="font-display text-lg font-medium">Your activity</h2>
            </div>
            <dl className="mt-4 divide-y divide-border text-sm">
              <div className="flex items-center justify-between py-3">
                <dt className="flex items-center gap-2 text-muted-foreground">
                  <ShoppingCart className="h-4 w-4" aria-hidden /> In cart
                </dt>
                <dd className="font-mono tabular-nums">{cartSummary.itemCount}</dd>
              </div>
              <div className="flex items-center justify-between py-3">
                <dt className="flex items-center gap-2 text-muted-foreground">
                  <Heart className="h-4 w-4" aria-hidden /> Wishlist
                </dt>
                <dd className="font-mono tabular-nums">{wishlistCount}</dd>
              </div>
              <div className="flex items-center justify-between py-3">
                <dt className="flex items-center gap-2 text-muted-foreground">
                  <Package className="h-4 w-4" aria-hidden /> Orders
                </dt>
                <dd className="font-mono tabular-nums">{orderCount}</dd>
              </div>
              <div className="flex items-center justify-between py-3">
                <dt className="flex items-center gap-2 text-muted-foreground">
                  <Store className="h-4 w-4" aria-hidden /> Listings
                </dt>
                <dd className="font-mono tabular-nums">{listingCount}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </Container>
  );
}
