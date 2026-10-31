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
}: {
  hasSellerProfile: boolean;
  isAdmin: boolean;
}): { primary: NavItem[]; account: NavItem[] } {
  const primary: NavItem[] = [
    { label: "Marketplace", href: "/marketplace" },
    { label: "Wishlist", href: "/buyer/wishlist" },
  ];

  if (hasSellerProfile || isAdmin) {
    primary.push(
      { label: "Dashboard", href: SELLER_DASHBOARD_PATH },
      { label: "Products", href: `${SELLER_DASHBOARD_PATH}/products` },
      { label: "Supplier catalog", href: `${SELLER_DASHBOARD_PATH}/suppliers` },
      { label: "Supplier orders", href: `${SELLER_DASHBOARD_PATH}/supplier-orders` },
      { label: "Orders", href: `${SELLER_DASHBOARD_PATH}/orders` },
      { label: "Sales", href: `${SELLER_DASHBOARD_PATH}/sales` },
    );
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
  const { primary, account } = buildNav({
    hasSellerProfile: user.hasSellerProfile,
    isAdmin: isAdministratorRole(user.role),
  });

  return (
    <div className="min-h-svh bg-[#0A0A0A] text-white">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#111111]">
        <div className="border-b border-white/10 bg-[#111111]">
          <Container className="flex items-center justify-between py-1.5 text-xs text-white/60">
            <span>Discover great finds on MaliHub</span>
            <Link href="/marketplace" className="font-semibold text-[#FF8C42] transition hover:text-white">
              Shop the marketplace
            </Link>
          </Container>
        </div>

        <Container className="flex flex-wrap items-center gap-3 py-3 sm:gap-5 sm:py-4">
          <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="MaliHub home">
            <span
              aria-hidden
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FF8C42] text-lg font-extrabold text-black"
            >
              M
            </span>
            <span className="font-display text-xl font-bold tracking-tight text-white">
              Mali<span className="text-orange-600">Hub</span>
            </span>
          </Link>

          <form action="/marketplace" method="get" className="order-3 flex w-full min-w-0 sm:order-none sm:mx-auto sm:max-w-2xl sm:flex-1">
            <label htmlFor="dashboard-marketplace-search" className="sr-only">
              Search products and listings
            </label>
            <div className="flex h-11 w-full overflow-hidden rounded-full border border-white/10 bg-[#1A1A1A] transition focus-within:border-[#FF8C42]/60 focus-within:ring-2 focus-within:ring-[#FF8C42]/15">
              <Search className="ml-3.5 mt-3 h-4 w-4 shrink-0 text-white/40" aria-hidden />
              <input
                id="dashboard-marketplace-search"
                name="q"
                type="search"
                placeholder="Search products, brands and more..."
                className="min-w-0 flex-1 bg-transparent px-3 text-sm text-white outline-none placeholder:text-white/35"
              />
              <button
                type="submit"
                className="flex shrink-0 items-center gap-2 bg-[#FF8C42] px-4 text-sm font-bold text-black transition hover:bg-[#ff9b5c] sm:px-5"
              >
                Search
              </button>
            </div>
          </form>

          <div className="ml-auto flex shrink-0 items-center gap-2 sm:ml-0 sm:gap-4">
            <NotificationBell isSignedIn />
            <Link
              href="/account"
              className="hidden items-center gap-2 rounded-lg px-2 py-1.5 text-white/60 transition hover:bg-white/5 hover:text-white sm:flex"
            >
              <UserRound className="h-5 w-5" aria-hidden />
              <span className="text-sm font-medium">Account</span>
            </Link>
            <Link
              href="/buyer/cart"
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-white/60 transition hover:bg-white/5 hover:text-white"
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

        <div className="border-t border-white/10 bg-[#111111]">
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
              <DashboardNavLinks items={[...primary, ...account]} mobile />
              <form action={signOutAction} className="shrink-0">
                <button type="submit" className="flex items-center gap-2 rounded-full border border-red-400/20 bg-[#141414] px-3.5 py-2 text-sm font-medium text-red-300 transition hover:bg-red-500/10">
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
