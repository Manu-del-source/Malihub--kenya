import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { acceptDeliveryQuoteSchema } from "@/lib/validations/delivery";
import { acceptDeliveryQuote, DeliveryQuoteError } from "@/modules/orders/delivery-quote-service";

type Context = { params: Promise<{ id: string }> };
export async function POST(request: NextRequest, context: Context) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;
  const user = (await getCurrentUser())?.user;
  if (!user) return NextResponse.json({ success: false, error: "Sign in required." }, { status: 401 });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ success: false, error: "Invalid order id." }, { status: 400 });
  const parsed = acceptDeliveryQuoteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: "Review and accept a valid delivery quote." }, { status: 400 });
  try {
    const data = await acceptDeliveryQuote(prisma, { userId: user.id, orderId: id, ...parsed.data });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof DeliveryQuoteError) return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: error.code === "not_found" ? 404 : error.code === "invalid" ? 400 : 409 });
    console.error("POST delivery quote acceptance failed", error);
    return NextResponse.json({ success: false, error: "Could not accept the delivery quote." }, { status: 500 });
  }
}
