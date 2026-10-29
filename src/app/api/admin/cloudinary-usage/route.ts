import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, isAdministratorRole } from "@/lib/auth";
import { getCloudinaryUsage } from "@/lib/cloudinary-usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin-only Cloudinary allowance status; refresh=1 bypasses the 60s cache. */
export async function GET(request: NextRequest) {
  const current = await getCurrentUser();
  const user = current?.user;
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!isAdministratorRole(user.role)) {
    return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  }

  try {
    const usage = await getCloudinaryUsage({
      refresh: request.nextUrl.searchParams.get("refresh") === "1",
    });
    return NextResponse.json({
      fetchedAt: usage.fetchedAt,
      creditUsagePercent: usage.creditUsagePercent,
      warning: usage.warning,
      uploadsBlockedByUsage: usage.blocked,
      uploadsManuallyPaused: process.env.CLOUDINARY_UPLOADS_PAUSED === "true",
      // The Cloudinary account metrics are available only to administrators.
      provider: usage.provider,
    });
  } catch {
    return NextResponse.json(
      { error: "Could not verify Cloudinary usage. Upload safeguards will remain closed until usage can be checked." },
      { status: 503 }
    );
  }
}
