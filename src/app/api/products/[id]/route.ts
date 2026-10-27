import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifySameOrigin } from "@/lib/csrf";
import { canViewListing, isPublicListingStatus } from "@/lib/listing-visibility";
import { listingSchema } from "@/lib/validations/listing";
import { toPublicListing, type PublicListingInput } from "@/lib/api-dtos";
import { updateListing, deleteListing, ListingServiceError } from "@/services/listing-service";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const product = await prisma.product.findUnique({
    where: { id },
    select: {
      id: true, ownerId: true, categoryId: true, title: true, slug: true,
      description: true, priceCents: true, isNegotiable: true, condition: true, brand: true,
      quantity: true, county: true, subCounty: true, status: true,
      isFeatured: true, publishedAt: true,
      images: { orderBy: { sortOrder: "asc" }, select: { id: true, url: true, sortOrder: true, isPrimary: true } },
      category: { select: { id: true, name: true, slug: true, iconName: true, imageUrl: true } },
      seller: { select: { businessName: true, slug: true, logoUrl: true, verificationStatus: true, ratingAverage: true, county: true } },
    },
  });

  if (!product) {
    return NextResponse.json({ success: false, error: "Listing not found." }, { status: 404 });
  }

  // Keep the anonymous fast path for genuinely public listings. An ACTIVE or
  // SOLD listing from a non-verified seller is not public; only then do we
  // resolve the viewer to check owner/admin access.
  const publicAndVerified =
    isPublicListingStatus(product.status) &&
    product.seller.verificationStatus === "VERIFIED";
  if (!publicAndVerified) {
    const viewer = (await getCurrentUser())?.user;
    if (!canViewListing(product, viewer)) {
      return NextResponse.json({ success: false, error: "Listing not found." }, { status: 404 });
    }
  }

  return NextResponse.json({ success: true, data: toPublicListing(product as unknown as PublicListingInput) });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;

  const { id } = await params;
  const user = (await getCurrentUser())?.user;
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
    // Publishing is gated by the seller's database-backed verification state,
    // even when this REST route is called directly rather than through the UI.
    if (parsed.data.status === "ACTIVE") {
      const seller = await prisma.seller.findUnique({
        where: { userId: user.id },
        select: { verificationStatus: true },
      });
      if (seller?.verificationStatus !== "VERIFIED") {
        return NextResponse.json(
          { success: false, error: "Complete seller verification before publishing a listing." },
          { status: 403 }
        );
      }
    }

    // Ownership is asserted inside updateListing against the *session* user —
    // the request never names a seller or owner.
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

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;

  const { id } = await params;
  const user = (await getCurrentUser())?.user;
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
