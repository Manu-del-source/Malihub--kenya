import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Your dashboard" };

export default async function BuyerDashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
