import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { verifySameOrigin } from "@/lib/csrf";
import { getRedis } from "@/lib/redis";
import { assertCloudinaryUploadsAllowed } from "@/lib/cloudinary-usage";
import { formatRetryAfter, rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { uploadMarketplaceImage } from "@/lib/cloudinary";
import { ImageValidationError, sanitizeImageBuffer } from "@/lib/validations/sanitize-image";
import { logServerError } from "@/lib/safe-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 1_000_000;
const MAX_MULTIPART_BYTES = 1_100_000;
const MAX_DIMENSION = 2_000;

function errorResponse(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

/** The only product/chat image upload path: validate and sanitize before storage. */
export async function POST(request: NextRequest) {
  const originCheck = verifySameOrigin(request);
  if (originCheck) return originCheck;

  const current = await getCurrentUser();
  const user = current?.user;
  if (!user) return errorResponse("Sign in before uploading images.", 401);

  if (!getRedis()) {
    return errorResponse("Image uploads are unavailable while upload protection is offline.", 503);
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_MULTIPART_BYTES) {
    return errorResponse("Image upload request is too large.", 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse("Expected a valid multipart image upload.", 400);
  }

  const purpose = form.get("purpose");
  const file = form.get("file");
  if ((purpose !== "product" && purpose !== "message") || !(file instanceof File) || file.size === 0) {
    return errorResponse("Choose one image to upload.", 400);
  }
  if (form.getAll("file").length !== 1 || [...form.keys()].some((key) => key !== "purpose" && key !== "file")) {
    return errorResponse("Unexpected upload fields.", 400);
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return errorResponse("Images must be 1 MB or smaller.", 413);
  }

  if (purpose === "product") {
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
        { success: false, error: `Upload limit reached (30 product images per rolling 24 hours). Try again in ${formatRetryAfter(limit.reset)}.` },
        { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil((limit.reset - Date.now()) / 1000))) } }
      );
    }
  } else {
    const limit = await rateLimit.messageImageUpload(user.id);
    if (!limit.success) {
      return NextResponse.json(
        { success: false, error: `Upload limit reached (20 chat images per rolling 24 hours). Try again in ${formatRetryAfter(limit.reset)}.` },
        { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil((limit.reset - Date.now()) / 1000))) } }
      );
    }
  }

  try {
    await assertCloudinaryUploadsAllowed();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const blocked = message.includes("85%") || message.includes("paused by the MaliHub administrator");
    return errorResponse(
      blocked
        ? "Image uploads are temporarily paused to protect MaliHub's Cloudinary allowance."
        : "Image uploads are temporarily unavailable because usage protection could not be verified.",
      503
    );
  }

  let sanitized;
  try {
    const input = Buffer.from(await file.arrayBuffer());
    sanitized = await sanitizeImageBuffer(input, file.type, {
      maxBytes: MAX_IMAGE_BYTES,
      maxDimension: MAX_DIMENSION,
      maxPixels: MAX_DIMENSION * MAX_DIMENSION,
    });
  } catch (error) {
    if (error instanceof ImageValidationError) return errorResponse(error.message, 415);
    logServerError("[image-upload] image sanitization failed", error);
    return errorResponse("This image is invalid or could not be safely processed.", 415);
  }

  try {
    const uploaded = await uploadMarketplaceImage(sanitized.buffer, purpose);
    return NextResponse.json({
      success: true,
      data: {
        url: uploaded.secureUrl,
        publicId: uploaded.publicId,
        format: "webp",
        width: sanitized.width,
        height: sanitized.height,
      },
    });
  } catch (error) {
    logServerError("[image-upload] Cloudinary upload failed", error);
    return errorResponse("The sanitized image could not be stored. Please try again.", 502);
  }
}
