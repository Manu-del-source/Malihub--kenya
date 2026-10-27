import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { deliveryEstimateSchema } from "@/lib/validations/delivery";
import { verifySameOrigin } from "@/lib/csrf";
import { estimateCountyDelivery } from "@/modules/orders/delivery-pricing";

export async function POST(request: NextRequest) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;

  const user = (await getCurrentUser())?.user;
  if (!user) return NextResponse.json({ success: false, error: "Sign in required." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const parsed = deliveryEstimateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Select a delivery county." }, { status: 400 });
  }

  try {
    return NextResponse.json({ success: true, data: estimateCountyDelivery(parsed.data.county) });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Delivery pricing is unavailable." },
      { status: 422 }
    );
  }
}
