import Link from "next/link";
import {
  Heart,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  Package,
  Search,
  ShieldCheck,
  ShoppingCart,
  Store,
  UserRound,
} from "lucide-react";
import { Container } from "@/components/ui/container";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { isAdministratorRole, requireUser } from "@/lib/auth";
import {
  ADMIN_DASHBOARD_PATH,
  SELLER_DASHBOARD_PATH,
} from "@/lib/auth/config";
import { signOutAction } from "@/app/(auth)/actions";

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

function NavIcon({ label }: { label: string }) {
  const className = "h-4 w-4 shrink-0";
  switch (label) {
    case "Marketplace":
      return <Store className={className} aria-hidden />;
    case "Wishlist":
      return <Heart className={className} aria-hidden />;
    case "Dashboard":
      return <LayoutDashboard className={className} aria-hidden />;
    case "Products":
      return <Package className={className} aria-hidden />;
    case "Orders":
    case "My orders":
      return <ShoppingCart className={className} aria-hidden />;
    case "Sales":
      return <Package className={className} aria-hidden />;
    case "Messages":
      return <MessageCircle className={className} aria-hidden />;
    case "Profile":
      return <UserRound className={className} aria-hidden />;
    case "Admin":
      return <ShieldCheck className={className} aria-hidden />;
    default:
      return null;
  }
}

function NavLinks({ items, mobile = false }: { items: NavItem[]; mobile?: boolean }) {
  return (
    <>
      {items.map((item) => (
        <Link
          key={`${item.label}-${item.href}`}
          href={item.href}
          className={
            mobile
              ? "flex shrink-0 items-center gap-2 rounded-full border border-orange-100 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:border-orange-300 hover:text-orange-700"
              : "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-orange-50 hover:text-orange-700"
          }
        >
          <NavIcon label={item.label} />
          {item.label}
        </Link>
      ))}
    </>
  );
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireUser();
  const { primary, account } = buildNav({
    hasSellerProfile: user.hasSellerProfile,
    isAdmin: isAdministratorRole(user.role),
  });

  return (
    <div className="min-h-svh bg-slate-50">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white shadow-sm">
        <div className="border-b border-orange-100 bg-orange-50">
          <Container className="flex items-center justify-between py-1.5 text-xs text-slate-600">
            <span>Discover great finds on MaliHub</span>
            <Link href="/marketplace" className="font-semibold text-orange-700 hover:text-orange-800">
              Shop the marketplace
            </Link>
          </Container>
        </div>

        <Container className="flex flex-wrap items-center gap-3 py-3 sm:gap-5 sm:py-4">
          <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="MaliHub home">
            <span
              aria-hidden
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500 text-lg font-extrabold text-white shadow-sm shadow-orange-200"
            >
              M
            </span>
            <span className="font-display text-xl font-bold tracking-tight text-slate-900">
              Mali<span className="text-orange-600">Hub</span>
            </span>
          </Link>

          <form action="/marketplace" method="get" className="order-3 flex w-full min-w-0 sm:order-none sm:mx-auto sm:max-w-2xl sm:flex-1">
            <label htmlFor="dashboard-marketplace-search" className="sr-only">
              Search products and listings
            </label>
            <div className="flex h-11 w-full overflow-hidden rounded-lg border border-slate-300 bg-white transition focus-within:border-orange-500 focus-within:ring-2 focus-within:ring-orange-100">
              <Search className="ml-3.5 mt-3 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
              <input
                id="dashboard-marketplace-search"
                name="q"
                type="search"
                placeholder="Search products, brands and more..."
                className="min-w-0 flex-1 bg-transparent px-3 text-sm text-slate-800 outline-none placeholder:text-slate-400"
              />
              <button
                type="submit"
                className="flex shrink-0 items-center gap-2 bg-orange-500 px-4 text-sm font-semibold text-white transition hover:bg-orange-600 sm:px-5"
              >
                Search
              </button>
            </div>
          </form>

          <div className="ml-auto flex shrink-0 items-center gap-2 sm:ml-0 sm:gap-4">
            <NotificationBell isSignedIn />
            <Link
              href="/account"
              className="hidden items-center gap-2 rounded-lg px-2 py-1.5 text-slate-700 transition hover:bg-orange-50 hover:text-orange-700 sm:flex"
            >
              <UserRound className="h-5 w-5" aria-hidden />
              <span className="text-sm font-medium">Account</span>
            </Link>
            <Link
              href="/buyer/cart"
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-slate-700 transition hover:bg-orange-50 hover:text-orange-700"
            >
              <ShoppingCart className="h-5 w-5" aria-hidden />
              <span className="hidden text-sm font-medium sm:inline">Cart</span>
            </Link>
            <form action={signOutAction} className="hidden sm:block">
              <button
                type="submit"
                aria-label="Sign out"
                title="Sign out"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-red-50 hover:text-red-600"
              >
                <LogOut className="h-4 w-4" aria-hidden />
              </button>
            </form>
          </div>
        </Container>

        <div className="border-t border-slate-100 bg-white">
          <Container>
            <nav className="hidden items-center gap-1 overflow-x-auto py-2 md:flex" aria-label="Account navigation">
              <NavLinks items={primary} />
              <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-slate-200" />
              <NavLinks items={account} />
              <div className="ml-auto flex shrink-0 items-center gap-2 pl-3">
                <form action={signOutAction}>
                  <button
                    type="submit"
                    className="flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-slate-500 transition hover:bg-red-50 hover:text-red-600"
                  >
                    <LogOut className="h-4 w-4" aria-hidden />
                    Sign out
                  </button>
                </form>
              </div>
            </nav>

            <nav className="flex gap-2 overflow-x-auto py-2.5 md:hidden" aria-label="Account navigation">
              <NavLinks items={[...primary, ...account]} mobile />
              <form action={signOutAction} className="shrink-0">
                <button type="submit" className="flex items-center gap-2 rounded-full border border-red-100 bg-white px-3.5 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50">
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
