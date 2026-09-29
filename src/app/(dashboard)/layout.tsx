import Link from "next/link";
import { LogOut } from "lucide-react";
import { Container } from "@/components/ui/container";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { isAdministratorRole, requireUser } from "@/lib/auth";
import {
  ADMIN_DASHBOARD_PATH,
  SELLER_DASHBOARD_PATH,
} from "@/lib/auth/config";
import { signOutAction } from "@/app/(auth)/actions";

/**
 * Rendered per request — never prerendered.
 *
 * This route reads the current session, and a session is per-request state. The
 * declaration is explicit rather than incidental on purpose: the previous
 * implementation got it for free because constructing a Supabase client called
 * `cookies()`, which Next.js treats as an opt into dynamic rendering. Reading a
 * Neon Auth session does not always do that — when the auth environment is not
 * configured the read short-circuits before touching a cookie — so a build run
 * without those variables would happily prerender this page as a static redirect
 * to /login and ship it that way, signing every visitor out.
 *
 * This is also what the Neon Auth Next.js documentation requires of any Server
 * Component that reads a session. See docs/auth/ARCHITECTURE.md §6.
 */
export const dynamic = "force-dynamic";

type NavItem = { label: string; href: string };

/**
 * Role-aware navigation.
 *
 * Links are built from MaliHub's OWN rows read on this request — never from a
 * claim — so what a visitor sees always matches what the guards below will
 * actually allow: seller links appear only for accounts with a `sellers` row
 * (or an administrator, whom `requireSellerAccess()` lets through for
 * support), and the admin link only for administrator roles. Hiding a link is
 * presentation only; every destination still re-checks server-side.
 */
function buildNav({
  hasSellerProfile,
  isAdmin,
}: {
  hasSellerProfile: boolean;
  isAdmin: boolean;
}): { primary: NavItem[]; shared: NavItem[] } {
  const primary: NavItem[] = [
    { label: "Marketplace", href: "/marketplace" },
    { label: "Cart", href: "/buyer/cart" },
    { label: "Wishlist", href: "/buyer/wishlist" },
  ];

  if (hasSellerProfile || isAdmin) {
    // Seller operating group — `/seller/*` re-verifies the sellers row on
    // every request via requireSellerAccess().
    primary.push(
      { label: "Dashboard", href: SELLER_DASHBOARD_PATH },
      { label: "Products", href: `${SELLER_DASHBOARD_PATH}/products` },
      { label: "Orders", href: `${SELLER_DASHBOARD_PATH}/orders` },
      { label: "Sales", href: `${SELLER_DASHBOARD_PATH}/sales` }
    );
  } else {
    // Buyers get their order history directly; sellers reach theirs through
    // the seller group above (their buyer orders remain on /buyer/orders).
    primary.push({ label: "Orders", href: "/buyer/orders" });
  }

  const shared: NavItem[] = [
    { label: "Profile", href: "/account" },
    { label: "Messages", href: "/messages" },
  ];
  if (isAdmin) shared.push({ label: "Admin", href: ADMIN_DASHBOARD_PATH });

  return { primary, shared };
}

function NavLinks({ items }: { items: NavItem[] }) {
  return (
    <>
      {items.map((item) => (
        <Link
          key={`${item.label}-${item.href}`}
          href={item.href}
          className="whitespace-nowrap transition-colors hover:text-foreground"
        >
          {item.label}
        </Link>
      ))}
    </>
  );
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Role and seller access are read from MaliHub's own rows on every request.
  // They used to come from the provider's `app_metadata` JWT claims, which could
  // lag the database until a session refresh re-minted the token. There is no
  // claim to go stale now, so a role change takes effect on the next request.
  const { user } = await requireUser();

  const { primary, shared } = buildNav({
    hasSellerProfile: user.hasSellerProfile,
    isAdmin: isAdministratorRole(user.role),
  });

  return (
    <div className="min-h-svh">
      <header className="border-b border-border">
        <Container className="flex items-center justify-between gap-6 py-4">
          <Link href="/" className="flex items-center gap-2 font-display text-lg font-medium">
            <span
              aria-hidden
              className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary-400 to-secondary text-sm font-semibold text-primary-foreground"
            >
              M
            </span>
            MaliHub
          </Link>

          <nav
            className="hidden items-center gap-5 text-sm text-muted-foreground md:flex"
            aria-label="Dashboard"
          >
            <NavLinks items={primary} />
            <span aria-hidden className="h-4 w-px bg-border" />
            <NavLinks items={shared} />
          </nav>

          <div className="flex items-center gap-3">
            <Link
              href="/messages"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground md:hidden"
            >
              Messages
            </Link>
            <NotificationBell isSignedIn />
            <form action={signOutAction}>
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden />
                Sign out
              </button>
            </form>
          </div>
        </Container>

        {/* Mobile: same role-aware links, horizontally scrollable. */}
        <div className="border-t border-border md:hidden">
          <Container>
            <nav
              className="flex gap-4 overflow-x-auto py-2.5 text-sm text-muted-foreground"
              aria-label="Dashboard (mobile)"
            >
              <NavLinks items={primary} />
              <NavLinks items={shared} />
            </nav>
          </Container>
        </div>
      </header>

      <main>{children}</main>
    </div>
  );
}
