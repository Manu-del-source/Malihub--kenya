import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { listingSchema } from "@/lib/validations/listing";
import { updateListing, deleteListing, ListingServiceError } from "@/services/listing-service";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const product = await prisma.product.findUnique({
    where: { id },
    include: { images: { orderBy: { sortOrder: "asc" } }, category: true },
  });

  if (!product) {
    return NextResponse.json({ success: false, error: "Listing not found." }, { status: 404 });
  }
  return NextResponse.json({ success: true, data: product });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Sign in required." }, { status: 401 });
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
    const product = await updateListing(id, user.id, parsed.data);
    return NextResponse.json({ success: true, data: { id: product.id, slug: product.slug } });
  } catch (error) {
    if (error instanceof ListingServiceError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 403 });
    }
    console.error("PATCH /api/products/[id] failed", error);
    return NextResponse.json({ success: false, error: "Something went wrong." }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Sign in required." }, { status: 401 });
  }

  try {
    await deleteListing(id, user.id);
    return NextResponse.json({ success: true, data: null });
  } catch (error) {
    if (error instanceof ListingServiceError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 403 });
    }
    console.error("DELETE /api/products/[id] failed", error);
    return NextResponse.json({ success: false, error: "Something went wrong." }, { status: 500 });
  }
}
