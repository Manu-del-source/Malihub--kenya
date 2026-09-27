import Link from "next/link";
import { LogOut } from "lucide-react";
import { Container } from "@/components/ui/container";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { isAdministratorRole, requireUser } from "@/lib/auth";
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

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Role and seller access are read from MaliHub's own rows on every request.
  // They used to come from the provider's `app_metadata` JWT claims, which could
  // lag the database until a session refresh re-minted the token. There is no
  // claim to go stale now, so a role change takes effect on the next request.
  const { user } = await requireUser();

  const hasSellerProfile = user.hasSellerProfile;
  const isAdmin = isAdministratorRole(user.role);

  return (
    <div className="min-h-svh">
      <header className="border-b border-border">
        <Container className="flex items-center justify-between py-4">
          <Link href="/" className="flex items-center gap-2 font-display text-lg font-medium">
            <span
              aria-hidden
              className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary-400 to-secondary text-sm font-semibold text-primary-foreground"
            >
              M
            </span>
            MaliHub
          </Link>

          <nav className="hidden items-center gap-6 text-sm text-muted-foreground sm:flex" aria-label="Dashboard">
            <Link href="/messages" className="transition-colors hover:text-foreground">
              Messages
            </Link>
            <Link href="/dashboard/buyer" className="transition-colors hover:text-foreground">
              Buyer
            </Link>
            {hasSellerProfile && (
              <Link href="/dashboard/seller" className="transition-colors hover:text-foreground">
                Seller
              </Link>
            )}
            {isAdmin && (
              <Link href="/dashboard/admin" className="transition-colors hover:text-foreground">
                Admin
              </Link>
            )}
          </nav>

          <div className="flex items-center gap-3">
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
      </header>

      <main>{children}</main>
    </div>
  );
}
