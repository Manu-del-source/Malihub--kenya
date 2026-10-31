export const dynamic = "force-dynamic";

import Link from "next/link";
import { LogOut, Search, ShoppingCart, UserRound } from "lucide-react";
import { Container } from "@/components/ui/container";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { isAdministratorRole, requireUser } from "@/lib/auth";
import {
  ADMIN_DASHBOARD_PATH,
  SELLER_DASHBOARD_PATH,
} from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { signOutAction } from "@/app/(auth)/actions";
import { DashboardNavLinks } from "@/components/shell/dashboard-nav-links";

/**
 * Role-aware navigation.
 *
 * The links are derived from MaliHub's own user and seller records. This is
 * only presentation; destination routes continue to enforce access server-side.
 */
type NavItem = { label: string; href: string };

function buildNav({
  hasSellerProfile,
  isAdmin,
  sellerVerified,
}: {
  hasSellerProfile: boolean;
  isAdmin: boolean;
  sellerVerified: boolean;
}): { primary: NavItem[]; account: NavItem[] } {
  const primary: NavItem[] = [
    { label: "Marketplace", href: "/marketplace" },
    { label: "Wishlist", href: "/buyer/wishlist" },
  ];

  if (hasSellerProfile || isAdmin) {
    primary.push({ label: "Dashboard", href: SELLER_DASHBOARD_PATH });
    // Supplier catalog is browsable before approval (the page handles the
    // unverified state). Everything else is empty until the seller is approved.
    primary.push({ label: "Supplier catalog", href: `${SELLER_DASHBOARD_PATH}/suppliers` });
    if (sellerVerified || isAdmin) {
      primary.push(
        { label: "Products", href: `${SELLER_DASHBOARD_PATH}/products` },
        { label: "Supplier orders", href: `${SELLER_DASHBOARD_PATH}/supplier-orders` },
        { label: "Orders", href: `${SELLER_DASHBOARD_PATH}/orders` },
        { label: "Sales", href: `${SELLER_DASHBOARD_PATH}/sales` },
      );
    }
  } else {
    primary.push({ label: "My orders", href: "/buyer/orders" });
  }

  const account: NavItem[] = [
    { label: "Messages", href: "/messages" },
    { label: "Profile", href: "/account" },
  ];
  if (isAdmin) account.push({ label: "Admin", href: ADMIN_DASHBOARD_PATH });

  return { primary, account };
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireUser();
  const seller = user.hasSellerProfile
    ? await prisma.seller.findUnique({
        where: { userId: user.id },
        select: { verificationStatus: true },
      })
    : null;
  const { primary, account } = buildNav({
    hasSellerProfile: user.hasSellerProfile,
    isAdmin: isAdministratorRole(user.role),
    sellerVerified: seller?.verificationStatus === "VERIFIED",
  });

  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-card">
        <Container className="flex flex-wrap items-center gap-3 py-3 sm:gap-5 sm:py-4">
          <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="MaliHub home">
            <span
              aria-hidden
              className="brand-mark flex h-10 w-10 items-center justify-center rounded-xl text-lg font-extrabold text-primary-foreground"
            >
              M
            </span>
            <span className="font-display text-xl font-bold tracking-tight text-foreground">
              Mali<span className="copper-text">Hub</span>
            </span>
          </Link>

          <form action="/marketplace" method="get" className="order-3 flex w-full min-w-0 sm:order-none sm:mx-auto sm:max-w-2xl sm:flex-1">
            <label htmlFor="dashboard-marketplace-search" className="sr-only">
              Search products and listings
            </label>
            <div className="flex h-11 w-full overflow-hidden rounded-full border border-border bg-muted transition focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/15">
              <Search className="ml-3.5 mt-3 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <input
                id="dashboard-marketplace-search"
                name="q"
                type="search"
                placeholder="Search products, brands and more..."
                className="min-w-0 flex-1 bg-transparent px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
              <button
                type="submit"
                className="flex shrink-0 items-center gap-2 bg-primary px-4 text-sm font-bold text-primary-foreground transition hover:bg-primary-400 sm:px-5"
              >
                Search
              </button>
            </div>
          </form>

          <div className="ml-auto flex shrink-0 items-center gap-2 sm:ml-0 sm:gap-4">
            <NotificationBell isSignedIn />
            <Link
              href="/account"
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-muted-foreground transition hover:bg-white/5 hover:text-white"
            >
              <UserRound className="h-5 w-5" aria-hidden />
              <span className="hidden text-sm font-medium sm:inline">Account</span>
            </Link>
            <Link
              href="/buyer/cart"
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-muted-foreground transition hover:bg-white/5 hover:text-white"
            >
              <ShoppingCart className="h-5 w-5" aria-hidden />
              <span className="hidden text-sm font-medium sm:inline">Cart</span>
            </Link>
            <form action={signOutAction} className="hidden sm:block">
              <button
                type="submit"
                aria-label="Sign out"
                title="Sign out"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-white/50 transition hover:bg-red-500/10 hover:text-red-300"
              >
                <LogOut className="h-4 w-4" aria-hidden />
              </button>
            </form>
          </div>
        </Container>

        <div className="border-t border-border bg-card">
          <Container>
            <nav className="hidden items-center gap-1 overflow-x-auto py-2 md:flex" aria-label="Account navigation">
              <DashboardNavLinks items={primary} />
              <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-white/10" />
              <DashboardNavLinks items={account} />
              <div className="ml-auto flex shrink-0 items-center gap-2 pl-3">
                <form action={signOutAction}>
                  <button
                    type="submit"
                    className="flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-white/50 transition hover:bg-red-500/10 hover:text-red-300"
                  >
                    <LogOut className="h-4 w-4" aria-hidden />
                    Sign out
                  </button>
                </form>
              </div>
            </nav>

            <nav className="flex gap-2 overflow-x-auto py-2.5 md:hidden" aria-label="Account navigation">
              <DashboardNavLinks items={[...primary, ...account.filter((i) => i.label !== "Profile")]} mobile />
              <form action={signOutAction} className="shrink-0">
                <button type="submit" className="flex items-center gap-2 rounded-full border border-red-400/20 bg-card px-3.5 py-2 text-sm font-medium text-red-300 transition hover:bg-red-500/10">
                  <LogOut className="h-4 w-4" aria-hidden />
                  Sign out
                </button>
              </form>
            </nav>
          </Container>
        </div>
      </header>

      <main>{children}</main>
    </div>
  );
}
