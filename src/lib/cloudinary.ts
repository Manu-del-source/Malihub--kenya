import "server-only";
import { v2 as cloudinary } from "cloudinary";
import { randomBytes } from "node:crypto";

/**
 * Server-side Cloudinary access — authenticated uploads only.
 *
 * This is deliberately the ONLY module that touches `CLOUDINARY_API_SECRET`.
 * It is `server-only` (importing it from client code fails the build), and
 * it performs authenticated REST uploads with the API key/secret, which the
 * browser never sees. The separate browser path (next-cloudinary's unsigned
 * widget for listing images) uses the public preset name instead and stays
 * where it is — the two share one Cloudinary account, not one credential
 * channel.
 */

export interface CloudinaryAvatarUpload {
  /** The `res.cloudinary.com/…` delivery URL to store on the profile. */
  secureUrl: string;
  /** `avatars/<userId>/avatar-…` — the asset's identity for later deletes. */
  publicId: string;
}

function configured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
  );
}

function cloudName(): string {
  const name = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  if (!name) throw new Error("CLOUDINARY cloud name is not configured");
  return name;
}

/**
 * Uploads an image buffer to the `avatars/<userId>/` folder via the
 * authenticated API and returns its delivery URL.
 *
 * The public id is caller-deterministic (a timestamp + random suffix), never
 * derived from any user-supplied string: a client can therefore neither
 * target another user's folder nor predict/overwrite an existing asset.
 */
export async function uploadAvatarImage(
  buffer: Buffer,
  mimeType: string,
  userId: string
): Promise<CloudinaryAvatarUpload> {
  if (!configured()) {
    throw new Error("CLOUDINARY_API_KEY/SECRET are not configured");
  }

  // UUID-shaped check is defence in depth for the folder segment — the id
  // comes from the verified session, but a malformed one must not escape the
  // `avatars/` folder scope (a `..` in a public_id is how Cloudinary folder
  // scoping gets bypassed).
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    throw new Error("Invalid user id for avatar upload");
  }

  const publicId = `avatars/${userId}/avatar-${Date.now()}-${randomBytes(4).toString("hex")}`;
  const dataUri = `data:${mimeType};base64,${buffer.toString("base64")}`;

  cloudinary.config({
    cloud_name: cloudName(),
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });

  const result = await cloudinary.uploader.upload(dataUri, {
    public_id: publicId,
    resource_type: "image",
    use_filename: false,
    overwrite: false, // the id is random — but never trust a collision anyway
  });

  return {
    secureUrl: result.secure_url,
    publicId: result.public_id ?? publicId,
  };
}

/**
 * Deletes an asset by public id. Best-effort by contract: callers wrap in
 * try/catch and never let a failed cleanup block the upload that replaced it.
 */
export async function deleteAsset(publicId: string): Promise<void> {
  if (!configured()) return;
  // Only delete inside OUR avatar folder — a public_id containing `..` or
  // escaping `avatars/` is refused, so a malformed stored URL can never be
  // turned into a delete of an unrelated asset.
  if (!/^avatars\/[0-9a-f-]{36}\/[^/]+$/.test(publicId)) return;

  cloudinary.config({
    cloud_name: cloudName(),
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });

  await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
}

/**
 * Derives the Cloudinary public id from one of OUR canonical avatar delivery
 * URLs (`https://res.cloudinary.com/<cloud>/image/upload/avatars/<userId>/…`),
 * or `null` when the URL is anything else (legacy Supabase URLs, other
 * folders, transformed/versioned deliveries). `null` means "do not attempt a
 * delete" — the Supabase migration explicitly must not delete its source
 * files.
 */
export function publicIdFromOwnAvatarUrl(url: string): string | null {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  if (!cloudName) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "res.cloudinary.com") return null;
    const segments = parsed.pathname.split("/").filter(Boolean);
    // /<cloud>/image/upload/<userId-folder…>
    if (segments[0] !== cloudName) return null;
    if (segments[1] !== "image" || segments[2] !== "upload") return null;
    const publicId = segments.slice(3).join("/");
    return /^avatars\/[0-9a-f-]{36}\/[^/]+$/.test(publicId) ? publicId : null;
  } catch {
    return null;
  }
}
