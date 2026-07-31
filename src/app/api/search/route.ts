import { NextResponse, type NextRequest } from "next/server";
import { searchParamsSchema } from "@/lib/validations/listing";
import { searchListings } from "@/services/search-service";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const parsed = searchParamsSchema.safeParse({
    q: searchParams.get("q") ?? undefined,
    category: searchParams.get("category") ?? undefined,
    county: searchParams.get("county") ?? undefined,
    town: searchParams.get("town") ?? undefined,
    brand: searchParams.get("brand") ?? undefined,
    condition: searchParams.get("condition") ?? undefined,
    minPrice: searchParams.get("minPrice") ?? undefined,
    maxPrice: searchParams.get("maxPrice") ?? undefined,
    sort: searchParams.get("sort") ?? undefined,
    cursor: searchParams.get("cursor") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid search parameters", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const result = await searchListings(parsed.data);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error("GET /api/search failed", error);
    return NextResponse.json({ success: false, error: "Search failed. Please try again." }, { status: 500 });
  }
}
