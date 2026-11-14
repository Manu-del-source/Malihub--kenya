import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AddressBookView } from "@/components/shell/buyer/address-book-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My addresses" };

export default async function AddressesPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const [{ user }, params] = await Promise.all([requireUser(), searchParams]);
  const returnTo = params.returnTo === "/checkout" ? "/checkout" : "/account";
  const addresses = await prisma.deliveryAddress.findMany({
    where: { userId: user.id },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    select: {
      id: true, label: true, recipientName: true, phone: true, county: true,
      subCounty: true, town: true, area: true, building: true, landmark: true,
      instructions: true, isDefault: true,
    },
  });
  return <AddressBookView initialAddresses={addresses} returnTo={returnTo} />;
}
