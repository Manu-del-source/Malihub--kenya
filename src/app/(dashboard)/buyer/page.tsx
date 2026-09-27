import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Rendered per request — never prerendered: this route reads the session.
 *
 * Required because reading a Neon Auth session does not necessarily touch a
 * cookie (an unconfigured environment short-circuits first), so Next.js would
 * otherwise prerender this page as a static redirect to /login. The full
 * reasoning is in the layout banners and docs/auth/ARCHITECTURE.md §6.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Your dashboard" };

export default async function BuyerDashboardPage() {
  const user = (await getCurrentUser())?.user;

  const profile = user
    ? await prisma.profile.findUnique({ where: { userId: user.id }, select: { fullName: true } })
    : null;

  return (
    <Container className="py-16">
      <div className="glass rounded-2xl p-10 text-center">
        <p className="text-sm text-muted-foreground">Signed in as</p>
        <h1 className="mt-1 font-display text-3xl font-medium">
          {profile?.fullName || user?.email}
        </h1>
        <p className="mx-auto mt-4 max-w-md text-sm text-muted-foreground">
          Your wishlist, cart, orders, and saved searches will live here — the full buyer
          dashboard is built in Phase 6. Authentication, sessions, and route protection are
          fully wired up already.
        </p>
      </div>
    </Container>
  );
}
