import { v2 as cloudinary } from "cloudinary";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { verifySameOrigin } from "@/lib/csrf";
import { getRedis } from "@/lib/redis";
import { rateLimit, formatRetryAfter } from "@/lib/rate-limit";
import { assertCloudinaryUploadsAllowed } from "@/lib/cloudinary-usage";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const LISTING_FOLDER = "malihub/products";
const MAX_SIGNATURE_AGE_SECONDS = 300;
const ALLOWED_SIGNED_PARAMS = new Set(["folder", "timestamp"]);

function errorResponse(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

/**
 * Cloudinary Upload Widget signature endpoint.
 *
 * A signature is issued only to a signed-in, verified seller. Redis is
 * mandatory here: quotas must not silently become unlimited when rate-limit
 * storage is unavailable. The browser never receives the Cloudinary API secret.
 */
export async function POST(request: NextRequest) {
  const originCheck = verifySameOrigin(request);
  if (originCheck) return originCheck;

  const current = await getCurrentUser();
  const user = current?.user;
  if (!user) return errorResponse("Sign in as a seller to upload product photos.", 401);

  if (!getRedis()) {
    return errorResponse("Image uploads are temporarily unavailable while upload protection is offline.", 503);
  }

  const seller = await prisma.seller.findUnique({
    where: { userId: user.id },
    select: { id: true, verificationStatus: true },
  });
  if (!seller || seller.verificationStatus !== "VERIFIED") {
    return errorResponse("Only verified sellers can upload product photos.", 403);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorResponse("Invalid upload signature request.", 400);
  }

  const rawParams = body.params_to_sign ?? body.paramsToSign;
  if (!rawParams || typeof rawParams !== "object" || Array.isArray(rawParams)) {
    return errorResponse("Missing signed upload parameters.", 400);
  }

  const params = rawParams as Record<string, unknown>;
  if (Object.keys(params).some((key) => !ALLOWED_SIGNED_PARAMS.has(key))) {
    return errorResponse("Unsupported upload parameters.", 400);
  }

  const timestamp = params.timestamp;
  if (typeof timestamp !== "number" || !Number.isInteger(timestamp)) {
    return errorResponse("Invalid upload timestamp.", 400);
  }
  const now = Math.floor(Date.now() / 1000);
  if (timestamp < now - MAX_SIGNATURE_AGE_SECONDS || timestamp > now + 60) {
    return errorResponse("Upload signature timestamp expired. Please retry.", 400);
  }
  if (params.folder !== LISTING_FOLDER) {
    return errorResponse("Uploads are restricted to the MaliHub product-image folder.", 400);
  }

  try {
    await assertCloudinaryUploadsAllowed();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Image uploads are temporarily paused.";
    const blocked = message.includes("85%") || message.includes("paused by the MaliHub administrator");
    return errorResponse(
      blocked ? "Product photo uploads are temporarily paused to protect MaliHub's storage allowance. Please try later." :
        "Image uploads are temporarily unavailable because usage protection could not be verified.",
      blocked ? 503 : 503
    );
  }

  const limit = await rateLimit.listingImageUpload(seller.id);
  if (!limit.success) {
    return NextResponse.json(
      { success: false, error: `Upload limit reached (30 images per rolling 24 hours). Try again in ${formatRetryAfter(limit.reset)}.` },
      {
        status: 429,
        headers: { "Retry-After": String(Math.max(1, Math.ceil((limit.reset - Date.now()) / 1000))) },
      }
    );
  }

  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!apiKey || !apiSecret || !process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME) {
    return errorResponse("Product image uploads are not configured. Please contact MaliHub support.", 503);
  }

  try {
    cloudinary.config({
      cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });
    const signature = cloudinary.utils.api_sign_request(params as Record<string, string | number>, apiSecret);
    return NextResponse.json({ signature });
  } catch {
    return errorResponse("Could not authorize this upload. Please try again.", 503);
  }
}
