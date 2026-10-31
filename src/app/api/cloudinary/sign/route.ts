import { NextResponse } from "next/server";

/**
 * Direct browser-to-Cloudinary signatures are intentionally disabled.
 * Product, chat and avatar images must pass through the server-side decoder
 * and re-encoder at /api/uploads/images or /api/avatar/upload first.
 */
export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    { success: false, error: "Direct uploads are disabled. Use MaliHub's secure image upload endpoint." },
    { status: 410 }
  );
}
