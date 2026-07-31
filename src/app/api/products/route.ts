import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { listingSchema, searchParamsSchema } from "@/lib/validations/listing";
import { searchListings } from "@/services/search-service";
import { createListing, ListingServiceError } from "@/services/listing-service";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const parsed = searchParamsSchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid query parameters" }, { status: 400 });
  }

  const result = await searchListings(parsed.data);
  return NextResponse.json({ success: true, data: result });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Sign in required." }, { status: 401 });
  }

  const seller = await prisma.seller.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!seller) {
    return NextResponse.json(
      { success: false, error: "Complete your seller setup before listing an item." },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = listingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const product = await createListing(user.id, seller.id, parsed.data);
    return NextResponse.json({ success: true, data: { id: product.id, slug: product.slug } }, { status: 201 });
  } catch (error) {
    if (error instanceof ListingServiceError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    console.error("POST /api/products failed", error);
    return NextResponse.json({ success: false, error: "Something went wrong." }, { status: 500 });
  }
}
