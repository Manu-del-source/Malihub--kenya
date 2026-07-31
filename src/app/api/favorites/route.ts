import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { toggleFavorite, ListingServiceError } from "@/services/listing-service";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ success: false, error: "Sign in required." }, { status: 401 });
  }

  const favorites = await prisma.wishlist.findMany({
    where: { userId: user.id },
    select: { productId: true },
  });

  return NextResponse.json({
    success: true,
    data: favorites.map((f: { productId: string }) => f.productId),
  });
}

const toggleSchema = z.object({ productId: z.string().uuid() });

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ success: false, error: "Sign in required." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = toggleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "A valid productId is required." }, { status: 400 });
  }

  try {
    const result = await toggleFavorite(user.id, parsed.data.productId);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof ListingServiceError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    console.error("POST /api/favorites failed", error);
    return NextResponse.json({ success: false, error: "Something went wrong." }, { status: 500 });
  }
}
