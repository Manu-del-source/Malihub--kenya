import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifySameOrigin } from "@/lib/csrf";
import { addToCart, updateCartItem, removeFromCart, getCart, CartError } from "@/services/cart-service";

/**
 * Buyer cart endpoint.
 *
 * Identity is resolved from the server session on every method — the body
 * carries only `productId`/`quantity`. There is no `userId` field to forge:
 * the cart service additionally scopes every query by the resolved id, so
 * one buyer can never read or touch another buyer's `cart_items`.
 *
 * Mutating methods run behind `verifySameOrigin` (the CSRF guard
 * `src/lib/csrf.ts` documents for Route Handlers); GET never needs it.
 */

const productIdSchema = z.string().uuid();
const quantitySchema = z.coerce.number().int().min(1).max(9999);

const addSchema = z.object({
  productId: productIdSchema,
  quantity: quantitySchema.optional().default(1),
});

const updateSchema = z.object({
  productId: productIdSchema,
  quantity: quantitySchema,
});

const removeSchema = z.object({ productId: productIdSchema });

function errorResponse(error: unknown, fallback: string, status = 400) {
  if (error instanceof CartError) {
    return NextResponse.json(
      { success: false, error: error.message, code: error.code },
      { status: error.code === "not_found" ? 404 : status }
    );
  }
  console.error(error);
  return NextResponse.json({ success: false, error: fallback }, { status: 500 });
}

export async function GET() {
  const user = (await getCurrentUser())?.user;
  if (!user) {
    return NextResponse.json({ success: false, error: "Sign in required." }, { status: 401 });
  }

  try {
    const cart = await getCart(prisma, user.id);
    return NextResponse.json({ success: true, data: cart });
  } catch (error) {
    return errorResponse(error, "Something went wrong.");
  }
}

export async function POST(request: NextRequest) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;

  const user = (await getCurrentUser())?.user;
  if (!user) {
    return NextResponse.json({ success: false, error: "Sign in required." }, { status: 401 });
  }

  const parsed = addSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "A valid productId and quantity are required." },
      { status: 400 }
    );
  }

  try {
    const cart = await addToCart(prisma, user.id, parsed.data.productId, parsed.data.quantity);
    return NextResponse.json({ success: true, data: cart }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "Something went wrong.");
  }
}

export async function PATCH(request: NextRequest) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;

  const user = (await getCurrentUser())?.user;
  if (!user) {
    return NextResponse.json({ success: false, error: "Sign in required." }, { status: 401 });
  }

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "A valid productId and quantity are required." },
      { status: 400 }
    );
  }

  try {
    const cart = await updateCartItem(
      prisma,
      user.id,
      parsed.data.productId,
      parsed.data.quantity
    );
    return NextResponse.json({ success: true, data: cart });
  } catch (error) {
    return errorResponse(error, "Something went wrong.");
  }
}

export async function DELETE(request: NextRequest) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;

  const user = (await getCurrentUser())?.user;
  if (!user) {
    return NextResponse.json({ success: false, error: "Sign in required." }, { status: 401 });
  }

  const parsed = removeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "A valid productId is required." },
      { status: 400 }
    );
  }

  try {
    const cart = await removeFromCart(prisma, user.id, parsed.data.productId);
    return NextResponse.json({ success: true, data: cart });
  } catch (error) {
    return errorResponse(error, "Something went wrong.");
  }
}
