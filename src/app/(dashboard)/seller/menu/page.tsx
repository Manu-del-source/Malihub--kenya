import Link from "next/link";
import type { Metadata } from "next";
import { ChevronRight, ShoppingBag } from "lucide-react";
import { Container } from "@/components/ui/container";
import { requireSellerAccess, isAdministratorRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildSellerMenu } from "@/lib/seller-menu";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Seller menu" };

/** Phone "More" tab for the seller workspace: every seller page not on the bar. */
export default async function SellerMenuPage() {
  const { user } = await requireSellerAccess();
  const seller = await prisma.seller.findUnique({ where: { userId: user.id }, select: { verificationStatus: true } });
  const items = buildSellerMenu({
    isAdmin: isAdministratorRole(user.role),
    sellerVerified: seller?.verificationStatus === "VERIFIED",
  });
  const rowClass =
    "flex min-h-14 items-center justify-between gap-3 px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary";

  return (
    <Container className="max-w-2xl space-y-4 py-4 pb-24 md:py-8">
      <h1 className="font-display text-2xl font-semibold">Seller menu</h1>
      <section aria-label="Seller sections" className="overflow-hidden rounded-2xl border border-border bg-card">
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className={rowClass}>
                {item.label}
                <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <Link href="/" className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-border bg-card text-sm font-medium text-muted-foreground transition hover:text-foreground">
        <ShoppingBag className="h-4 w-4" aria-hidden />
        Back to shopping
      </Link>
    </Container>
  );
}
