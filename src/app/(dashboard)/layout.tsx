import Link from "next/link";
import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { Container } from "@/components/ui/container";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { createClient } from "@/lib/supabase/server";
import { signOutAction } from "@/app/(auth)/actions";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const role = (user.app_metadata?.role as string) ?? "BUYER";
  const hasSellerProfile = user.app_metadata?.has_seller_profile === true;
  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";

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
