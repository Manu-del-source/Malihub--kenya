import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, PackageCheck, ShieldCheck, Store } from "lucide-react";
import { Container } from "@/components/ui/container";
import { StartSellingButton } from "@/components/shell/buyer/start-selling-button";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const metadata = { title: "Seller Centre — MaliHub" };

export default async function SellerCentrePage() {
  const { user } = await requireUser();
  const [seller, profile] = await Promise.all([prisma.seller.findUnique({
    where: { userId: user.id },
    select: { id: true },
  }), prisma.profile.findUnique({ where: { userId: user.id }, select: { onboarded: true } })]);

  // Existing applicants and approved sellers continue in their dedicated workspace.
  if (seller) redirect("/seller");

  return (
    <Container className="max-w-5xl py-12 sm:py-16">
      <section className="overflow-hidden rounded-3xl border border-border bg-card">
        <div className="grid gap-10 p-6 sm:p-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary-300">
              MaliHub Seller Programme
            </p>
            <h1 className="mt-3 max-w-xl font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              Bring your business to MaliHub.
            </h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground">
              Open your shop, reach buyers across Kenya and manage your products and orders from one dedicated Seller Centre.
            </p>
            <div className="mt-7">
              {profile?.onboarded ? <StartSellingButton /> : <Link href="/complete-profile" className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90">Complete your account first <ArrowRight className="h-4 w-4" aria-hidden /></Link>}
              <p className="mt-3 text-xs text-muted-foreground">
                Applications are reviewed by MaliHub before product publishing is enabled.
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <div className="rounded-2xl border border-border bg-background/70 p-5">
              <Store className="h-5 w-5 text-primary-300" aria-hidden />
              <h2 className="mt-3 font-semibold text-foreground">Your own shop</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">Create a business profile buyers can recognise and trust.</p>
            </div>
            <div className="rounded-2xl border border-border bg-background/70 p-5">
              <PackageCheck className="h-5 w-5 text-primary-300" aria-hidden />
              <h2 className="mt-3 font-semibold text-foreground">Manage products and orders</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">Keep listings, stock and customer orders organised.</p>
            </div>
            <div className="rounded-2xl border border-border bg-background/70 p-5 sm:col-span-2 lg:col-span-1">
              <ShieldCheck className="h-5 w-5 text-primary-300" aria-hidden />
              <h2 className="mt-3 font-semibold text-foreground">Reviewed seller applications</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">MaliHub reviews business profiles before sellers can publish listings.</p>
            </div>
          </div>
        </div>
      </section>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <p>Already have a seller profile? Your Seller Centre is ready.</p>
        <Link href="/account" className="inline-flex items-center gap-2 text-primary-300 hover:text-foreground">
          Return to your account <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </Container>
  );
}
