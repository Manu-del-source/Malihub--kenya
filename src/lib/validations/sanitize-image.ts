import "server-only";
import sharp, { type Metadata } from "sharp";
import { classifyImageMagic, mimeTypeFor, type ImageKind } from "@/lib/validations/image-file";

export class ImageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageValidationError";
  }
}

export type SanitizedImage = {
  buffer: Buffer;
  mimeType: "image/webp";
  width: number;
  height: number;
  originalKind: ImageKind;
};

/** Verify bytes and MIME, fully decode, reject multi-frame/oversized inputs,
 * apply EXIF orientation, and re-encode pixels as fresh WebP. Source metadata
 * and appended/unrecognized payload bytes are never copied to the output. */
export async function sanitizeImageBuffer(
  input: Buffer,
  declaredMime: string,
  limits: { maxBytes: number; maxDimension: number; maxPixels?: number }
): Promise<SanitizedImage> {
  if (!input.length || input.length > limits.maxBytes) {
    throw new ImageValidationError("Image is empty or exceeds the upload size limit.");
  }
  const kind = classifyImageMagic(input);
  if (!kind || declaredMime !== mimeTypeFor(kind)) {
    throw new ImageValidationError("File contents do not match an accepted image type.");
  }

  const maxPixels = limits.maxPixels ?? limits.maxDimension * limits.maxDimension;
  let metadata: Metadata;
  try {
    metadata = await sharp(input, {
      failOn: "error",
      limitInputPixels: maxPixels,
      sequentialRead: true,
    }).metadata();
  } catch {
    throw new ImageValidationError("The image is malformed or cannot be decoded.");
  }

  if (metadata.format !== kind || !metadata.width || !metadata.height) {
    throw new ImageValidationError("The image format is invalid.");
  }
  if (metadata.pages && metadata.pages > 1) {
    throw new ImageValidationError("Animated or multi-frame images are not accepted.");
  }

  const swapsDimensions = [5, 6, 7, 8].includes(metadata.orientation ?? 0);
  const width = swapsDimensions ? metadata.height : metadata.width;
  const height = swapsDimensions ? metadata.width : metadata.height;
  if (width > limits.maxDimension || height > limits.maxDimension || width * height > maxPixels) {
    throw new ImageValidationError(`Image dimensions must not exceed ${limits.maxDimension} × ${limits.maxDimension} pixels.`);
  }

  let output: Buffer;
  try {
    output = await sharp(input, {
      failOn: "error",
      limitInputPixels: maxPixels,
      sequentialRead: true,
    })
      .rotate()
      .webp({ quality: 82, effort: 4, smartSubsample: true })
      .toBuffer();
  } catch {
    throw new ImageValidationError("The image could not be safely processed.");
  }

  if (!output.length || output.length > limits.maxBytes) {
    throw new ImageValidationError("The sanitized image exceeds the upload size limit.");
  }
  return { buffer: output, mimeType: "image/webp", width, height, originalKind: kind };
}
