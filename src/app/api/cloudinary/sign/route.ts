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
const MESSAGE_FOLDER = "malihub/messages";
const MAX_SIGNATURE_AGE_SECONDS = 300;
const ALLOWED_SIGNED_PARAMS = new Set(["folder", "timestamp", "source", "upload_preset"]);

function errorResponse(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

/**
 * Signed upload endpoint for product and message images. Only approved folders
 * and minimal parameters are signed. Product uploads require a verified seller;
 * quotas and global Cloudinary usage checks run before a signature is issued.
 */
export async function POST(request: NextRequest) {
  const originCheck = verifySameOrigin(request);
  if (originCheck) return originCheck;

  const current = await getCurrentUser();
  const user = current?.user;
  if (!user) return errorResponse("Sign in before uploading images.", 401);

  const redis = getRedis();
  if (!redis) {
    return errorResponse("Image uploads are temporarily unavailable while upload protection is offline.", 503);
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

  if (params.source !== undefined && params.source !== "uw") {
    return errorResponse("Invalid upload source.", 400);
  }

  const signedPreset = process.env.NEXT_PUBLIC_CLOUDINARY_SIGNED_UPLOAD_PRESET;
  if (!signedPreset || params.upload_preset !== signedPreset) {
    return errorResponse("The restricted signed upload preset is not configured.", 503);
  }

  const folder = params.folder;
  if (folder !== LISTING_FOLDER && folder !== MESSAGE_FOLDER) {
    return errorResponse("Uploads are restricted to approved MaliHub image folders.", 400);
  }

  const timestamp = params.timestamp;
  if (typeof timestamp !== "number" || !Number.isInteger(timestamp)) {
    return errorResponse("Invalid upload timestamp.", 400);
  }
  const now = Math.floor(Date.now() / 1000);
  if (timestamp < now - MAX_SIGNATURE_AGE_SECONDS || timestamp > now + 60) {
    return errorResponse("Upload signature timestamp expired. Please retry.", 400);
  }

  try {
    await assertCloudinaryUploadsAllowed();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const blocked = message.includes("85%") || message.includes("paused by the MaliHub administrator");
    return errorResponse(
      blocked
        ? "Image uploads are temporarily paused to protect MaliHub's Cloudinary allowance. Please try later."
        : "Image uploads are temporarily unavailable because usage protection could not be verified.",
      503
    );
  }

  if (folder === LISTING_FOLDER) {
    const seller = await prisma.seller.findUnique({
      where: { userId: user.id },
      select: { id: true, verificationStatus: true },
    });
    if (!seller || seller.verificationStatus !== "VERIFIED") {
      return errorResponse("Only verified sellers can upload product photos.", 403);
    }

    const limit = await rateLimit.listingImageUpload(seller.id);
    if (!limit.success) {
      return NextResponse.json(
        { success: false, error: `Upload limit reached (30 product-image signatures per rolling 24 hours). Try again in ${formatRetryAfter(limit.reset)}.` },
        {
          status: 429,
          headers: { "Retry-After": String(Math.max(1, Math.ceil((limit.reset - Date.now()) / 1000))) },
        }
      );
    }
  } else {
    const limit = await rateLimit.messageImageUpload(user.id);
    if (!limit.success) {
      return NextResponse.json(
        { success: false, error: `Upload limit reached (20 message-image signatures per rolling 24 hours). Try again in ${formatRetryAfter(limit.reset)}.` },
        {
          status: 429,
          headers: { "Retry-After": String(Math.max(1, Math.ceil((limit.reset - Date.now()) / 1000))) },
        }
      );
    }
  }

  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  if (!apiKey || !apiSecret || !cloudName || !process.env.NEXT_PUBLIC_CLOUDINARY_API_KEY) {
    return errorResponse("Image uploads are not configured. Please contact MaliHub support.", 503);
  }

  try {
    cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
    // Cloudinary adds source=uw to Upload Widget requests; include it in the
    // signature even when the widget omits it from paramsToSign.
    const signingParams = { ...params, source: "uw" } as Record<string, string | number>;
    const signature = cloudinary.utils.api_sign_request(signingParams, apiSecret);
    return NextResponse.json({ signature });
  } catch {
    return errorResponse("Could not authorize this upload. Please try again.", 503);
  }
}
