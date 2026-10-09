import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifySameOrigin } from "@/lib/csrf";
import {
  createPaystackClient,
  resolvePaystackConfig,
  PaystackClientError,
} from "@/lib/payments/paystack";

/**
 * Initialize a Paystack-hosted checkout for the signed-in buyer's own order.
 * All money and identity fields are derived from trusted server-side records.
 * This endpoint never marks an order paid.
 */
export async function POST(request: NextRequest) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;

  const user = (await getCurrentUser())?.user;
  if (!user) {
    return NextResponse.json({ success: false, error: "Sign in required." }, { status: 401 });
  }
  if (!user.email) {
    return NextResponse.json({ success: false, error: "Your account needs an email address to pay." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || !("orderId" in body) ||
      typeof (body as { orderId?: unknown }).orderId !== "string" ||
      !(body as { orderId: string }).orderId.trim() ||
      (body as { orderId: string }).orderId.length > 100) {
    return NextResponse.json({ success: false, error: "A valid orderId is required." }, { status: 400 });
  }

  const config = resolvePaystackConfig(process.env);
  if (!config.ok) {
    console.error("[payments] Paystack configuration invalid", config);
    return NextResponse.json({ success: false, error: "Online payments are temporarily unavailable.", code: "provider_not_configured" }, { status: 503 });
  }

  const orderId = (body as { orderId: string }).orderId;
  const order = await prisma.order.findFirst({
    where: { id: orderId, buyerId: user.id },
    select: { id: true, orderNumber: true, status: true, totalCents: true },
  });
  if (!order) return NextResponse.json({ success: false, error: "Order not found." }, { status: 404 });
  if (order.status === "PAID") return NextResponse.json({ success: false, error: "This order has already been paid." }, { status: 409 });
  if (order.status !== "PENDING") return NextResponse.json({ success: false, error: "This order is not awaiting payment." }, { status: 409 });
  if (!Number.isSafeInteger(order.totalCents) || order.totalCents <= 0) {
    return NextResponse.json({ success: false, error: "This order amount cannot be collected." }, { status: 409 });
  }

  // Reuse an in-flight attempt so a double-click does not create a second
  // provider transaction. The webhook and verify endpoint still decide payment.
  const existing = await prisma.payment.findFirst({
    where: { orderId: order.id, provider: "PAYSTACK", status: { in: ["PENDING", "PROCESSING"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, customerReference: true, metadata: true },
  });
  if (existing) {
    const meta = existing.metadata as { paystack?: { authorizationUrl?: string } } | null;
    if (meta?.paystack?.authorizationUrl) {
      return NextResponse.json({ success: true, data: { authorizationUrl: meta.paystack.authorizationUrl, reference: existing.customerReference, reused: true } });
    }
    // An earlier request may have timed out after Paystack accepted it. Do not
    // blindly create another charge; ask the buyer to retry status/support.
    return NextResponse.json({ success: false, error: "This payment is still being initialized. Please wait a moment and check again.", code: "payment_initializing" }, { status: 409 });
  }

  const reference = `MH-${randomUUID().replace(/-/g, "")}`;
  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      provider: "PAYSTACK",
      method: "MOBILE_MONEY",
      status: "PENDING",
      amountCents: order.totalCents,
      currency: "KES",
      customerReference: reference,
      retryCount: 0,
      metadata: { paystack: { initialization: "pending" } },
    },
    select: { id: true },
  });

  try {
    const client = createPaystackClient(config.config);
    const initialized = await client.initializeTransaction({
      email: user.email,
      amountSubunits: order.totalCents,
      reference,
      metadata: { orderNumber: order.orderNumber, paymentId: payment.id },
    });
    await prisma.payment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: {
        status: "PROCESSING",
        metadata: {
          paystack: {
            accessCode: initialized.access_code,
            authorizationUrl: initialized.authorization_url,
            initialization: "accepted",
          },
        },
      },
    });
    return NextResponse.json({
      success: true,
      data: { authorizationUrl: initialized.authorization_url, reference: initialized.reference, reused: false },
    });
  } catch (error) {
    // Preserve the reserved row/reference: a timeout can be ambiguous, so
    // never create a fresh reference automatically in this request.
    await prisma.payment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: { metadata: { paystack: { initialization: "unknown" } } },
    }).catch(() => undefined);
    if (error instanceof PaystackClientError) {
      const status = error.kind === "not_configured" ? 503 : error.kind === "rejected" ? 502 : 503;
      return NextResponse.json({ success: false, error: "Paystack could not start checkout. Check payment status before retrying.", code: "provider_unavailable" }, { status });
    }
    console.error("POST /api/payments/paystack/initialize failed", error);
    return NextResponse.json({ success: false, error: "Something went wrong." }, { status: 500 });
  }
}
