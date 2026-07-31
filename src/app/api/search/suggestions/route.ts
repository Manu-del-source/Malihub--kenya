import { NextResponse, type NextRequest } from "next/server";
import { getSearchSuggestions } from "@/services/search-service";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";

  try {
    const suggestions = await getSearchSuggestions(q);
    return NextResponse.json({ success: true, data: suggestions });
  } catch (error) {
    console.error("GET /api/search/suggestions failed", error);
    return NextResponse.json({ success: false, error: "Couldn't load suggestions." }, { status: 500 });
  }
}
