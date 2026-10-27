import { NextResponse, type NextRequest } from "next/server";
import { verifySameOrigin } from "@/lib/csrf";
import { estimateCountyDelivery } from "@/modules/orders/delivery-pricing";

export async function POST(request: NextRequest) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;

  const body = await request.json().catch(() => null);
  const county = typeof body?.county === "string" ? body.county.trim() : "";
  if (!county || county.length > 80) {
    return NextResponse.json({ success: false, error: "Select a delivery county." }, { status: 400 });
  }

  try {
    return NextResponse.json({ success: true, data: estimateCountyDelivery(county) });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Delivery pricing is unavailable." },
      { status: 422 }
    );
  }
}
