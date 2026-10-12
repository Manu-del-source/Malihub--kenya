/**
 * Magic-byte image classification — the server-side half of upload
 * validation.
 *
 * A browser's `file.type` is whatever the uploader told it (a renamed `.txt`
 * with a forged Content-Type sails through), so the authoritative answer
 * comes from the file's own bytes. This module answers one question —
 * "is this buffer really a JPEG/PNG/WebP, and which?" — for every
 * server-side image upload path (avatars, and anything later that needs it).
 */

export type ImageKind = "jpeg" | "png" | "webp";

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP = [0x57, 0x45, 0x42, 0x50]; // "WEBP"

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

/**
 * Classifies a buffer by its magic bytes.
 *
 * Returns the kind, or `null` when the bytes match none of the accepted
 * formats (including buffers too short to carry any signature — a 3-byte
 * "JPEG" is a lie, not an image).
 */
export function classifyImageMagic(bytes: Uint8Array): ImageKind | null {
  if (startsWith(bytes, JPEG)) return "jpeg";
  if (startsWith(bytes, PNG)) return "png";
  // WebP: "RIFF" at offset 0 and "WEBP" at offset 8.
  if (startsWith(bytes, RIFF) && bytes.length >= 12) {
    const tag = Array.from(bytes.subarray(8, 12));
    if (tag.every((value, index) => value === WEBP[index])) return "webp";
  }
  return null;
}

/** The Content-Type corresponding to a classified kind (for data-URI uploads). */
export function mimeTypeFor(kind: ImageKind): string {
  switch (kind) {
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
  }
}
