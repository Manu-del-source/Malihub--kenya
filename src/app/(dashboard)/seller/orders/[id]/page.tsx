import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { SellerOrderCard } from "@/components/shell/seller/seller-order-card";
import { requireSellerAccess } from "@/lib/auth";
import { SELLER_DASHBOARD_PATH } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { getSellerOrder } from "@/services/order-service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Order" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function SellerOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const { user } = await requireSellerAccess();
  // Ownership is enforced inside the service: another seller's order is null.
  const order = await getSellerOrder(prisma, user.id, id);
  if (!order) notFound();

  return (
    <Container className="py-8 sm:py-10">
      <Link href={`${SELLER_DASHBOARD_PATH}/orders`} className="text-sm text-primary-400 hover:underline">
        ← All orders
      </Link>
      <h1 className="mb-6 mt-3 font-display text-3xl font-medium">Order {order.orderNumber}</h1>
      <SellerOrderCard order={order} />
    </Container>
  );
}
