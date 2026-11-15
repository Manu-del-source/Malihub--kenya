export const dynamic = "force-dynamic";

import Link from "next/link";
import { LogOut, Search, ShoppingCart, UserRound } from "lucide-react";
import { Container } from "@/components/ui/container";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { isAdministratorRole, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCartSummary } from "@/services/cart-service";
import { signOutAction } from "@/app/(auth)/actions";
import { DashboardNavLinks } from "@/components/shell/dashboard-nav-links";
import { MobileBottomNav } from "@/components/shell/mobile-bottom-nav";
import { buildDashboardNav } from "@/lib/dashboard-nav";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireUser();
  const seller = user.hasSellerProfile
    ? await prisma.seller.findUnique({
        where: { userId: user.id },
        select: { verificationStatus: true },
      })
    : null;
  // Cart badge for the phone bar; a failed lookup must never break the page.
  const cartCount = await getCartSummary(prisma, user.id).then((c) => c.itemCount).catch(() => 0);
  const { primary, account } = buildDashboardNav({
    hasSellerProfile: user.hasSellerProfile,
    isAdmin: isAdministratorRole(user.role),
    sellerVerified: seller?.verificationStatus === "VERIFIED",
  });

  return (
    <div className="pwa-dashboard-shell min-h-svh bg-background text-foreground">
      <header className="pwa-dashboard-header sticky top-0 z-50 border-b border-border bg-card">
        <Container className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 md:flex-nowrap md:gap-5 md:py-4">
          <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="MaliHub home">
            <span aria-hidden className="brand-mark flex h-10 w-10 items-center justify-center rounded-xl text-lg font-extrabold text-primary-foreground">M</span>
            <span className="font-display text-xl font-bold tracking-tight text-foreground">
              Mali<span className="copper-text">Hub</span>
            </span>
          </Link>

          <form action="/marketplace" method="get" className="order-3 flex w-full min-w-0 md:order-none md:mx-auto md:max-w-2xl md:flex-1">
            <label htmlFor="dashboard-marketplace-search" className="sr-only">Search products and listings</label>
            <div className="flex h-11 w-full overflow-hidden rounded-full border border-border bg-muted transition focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/15">
              <Search className="ml-3.5 mt-3 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <input id="dashboard-marketplace-search" name="q" type="search" enterKeyHint="search" placeholder="Search products, brands and more..." className="min-w-0 flex-1 bg-transparent px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground" />
              <button type="submit" className="hidden shrink-0 items-center gap-2 bg-primary px-5 text-sm font-bold text-primary-foreground transition hover:bg-primary-400 md:flex">Search</button>
            </div>
          </form>

          <div className="ml-auto flex shrink-0 items-center gap-1 md:ml-0 md:gap-4">
            <NotificationBell isSignedIn />
            <Link href="/account" className="hidden items-center gap-2 rounded-lg px-2 py-1.5 text-muted-foreground transition hover:bg-foreground/5 hover:text-foreground md:flex">
              <UserRound className="h-5 w-5" aria-hidden />
              <span className="text-sm font-medium">Account</span>
            </Link>
            <Link href="/buyer/cart" aria-label="Cart" className="hidden items-center gap-2 rounded-lg px-2 py-1.5 text-muted-foreground transition hover:bg-foreground/5 hover:text-foreground md:flex">
              <ShoppingCart className="h-5 w-5" aria-hidden />
              <span className="hidden text-sm font-medium md:inline">Cart</span>
            </Link>
            <form action={signOutAction} className="hidden md:block">
              <button type="submit" aria-label="Sign out" title="Sign out" className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-red-500/10 hover:text-red-300">
                <LogOut className="h-4 w-4" aria-hidden />
              </button>
            </form>
          </div>
        </Container>

        <div className="hidden border-t border-border bg-card md:block">
          <Container>
            <nav className="pwa-dashboard-links flex items-center gap-1 overflow-x-auto py-2" aria-label="Account navigation">
              <DashboardNavLinks items={primary} />
              <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-foreground/10" />
              <DashboardNavLinks items={account} />
              <div className="ml-auto flex shrink-0 items-center gap-2 pl-3">
                <form action={signOutAction}>
                  <button type="submit" className="flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-red-500/10 hover:text-red-300">
                    <LogOut className="h-4 w-4" aria-hidden />
                    Sign out
                  </button>
                </form>
              </div>
            </nav>
          </Container>
        </div>
      </header>

      <main className="pb-20 md:pb-0">{children}</main>
      <MobileBottomNav hasSellerProfile={user.hasSellerProfile} cartCount={cartCount} />
    </div>
  );
}
