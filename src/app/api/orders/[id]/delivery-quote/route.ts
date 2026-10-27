import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { deliveryQuoteSchema } from "@/lib/validations/delivery";
import { DeliveryQuoteError, readBuyerDeliveryQuote, submitDeliveryQuote } from "@/modules/orders/delivery-quote-service";
import { notifyUser } from "@/services/notification-service";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: Context) {
  const user = (await getCurrentUser())?.user;
  if (!user) return NextResponse.json({ success: false, error: "Sign in required." }, { status: 401 });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ success: false, error: "Invalid order id." }, { status: 400 });
  try {
    const data = await readBuyerDeliveryQuote(prisma, user.id, id);
    if (!data) return NextResponse.json({ success: false, error: "Order not found." }, { status: 404 });
    return NextResponse.json({ success: true, data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET delivery quote failed", error);
    return NextResponse.json({ success: false, error: "Could not load delivery details." }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: Context) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;
  const user = (await getCurrentUser())?.user;
  if (!user) return NextResponse.json({ success: false, error: "Sign in required." }, { status: 401 });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ success: false, error: "Invalid order id." }, { status: 400 });
  const parsed = deliveryQuoteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: "Enter a valid delivery amount and note (up to 500 characters)." }, { status: 400 });
  try {
    const result = await submitDeliveryQuote(prisma, { userId: user.id, orderId: id, ...parsed.data });
    if (result.changed) {
      await notifyUser({ userId: result.buyerId, type: "ORDER_UPDATE", title: "Delivery quote to review", body: `The seller updated delivery for order ${result.orderNumber}. Review and accept the quote before paying.`, linkUrl: `/buyer/orders/${id}`, sendEmailToo: false }).catch(() => undefined);
    }
    return NextResponse.json({ success: true, data: { changed: result.changed } });
  } catch (error) {
    if (error instanceof DeliveryQuoteError) return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: error.code === "not_found" ? 404 : error.code === "invalid" ? 400 : 409 });
    console.error("POST delivery quote failed", error);
    return NextResponse.json({ success: false, error: "Could not submit the delivery quote." }, { status: 500 });
  }
}
