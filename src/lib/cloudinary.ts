import "server-only";
import { v2 as cloudinary } from "cloudinary";
import { randomBytes } from "node:crypto";

/** All Cloudinary writes are authenticated server-side uploads. */
export interface CloudinaryAvatarUpload {
  secureUrl: string;
  publicId: string;
}
export interface CloudinaryImageUpload {
  secureUrl: string;
  publicId: string;
}

function configured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
}
function cloudName(): string {
  const name = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  if (!name) throw new Error("CLOUDINARY cloud name is not configured");
  return name;
}
function configureCloudinary(): void {
  if (!configured()) throw new Error("CLOUDINARY_API_KEY/SECRET are not configured");
  cloudinary.config({
    cloud_name: cloudName(),
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

/** Upload a sanitized WebP into a fixed, server-selected folder. */
export async function uploadMarketplaceImage(buffer: Buffer, purpose: "product" | "message"): Promise<CloudinaryImageUpload> {
  configureCloudinary();
  const folder = purpose === "product" ? "malihub/products" : "malihub/messages";
  const publicId = `image-${Date.now()}-${randomBytes(16).toString("hex")}`;
  const dataUri = `data:image/webp;base64,${buffer.toString("base64")}`;
  const result = await cloudinary.uploader.upload(dataUri, {
    folder,
    public_id: publicId,
    resource_type: "image",
    format: "webp",
    allowed_formats: ["webp"],
    use_filename: false,
    unique_filename: false,
    overwrite: false,
  });
  return {
    secureUrl: result.secure_url,
    publicId: result.public_id ?? `${folder}/${publicId}`,
  };
}

/** Upload a sanitized image buffer to the avatars/<userId>/ folder. */
export async function uploadAvatarImage(buffer: Buffer, mimeType: string, userId: string): Promise<CloudinaryAvatarUpload> {
  configureCloudinary();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    throw new Error("Invalid user id for avatar upload");
  }
  const publicId = `avatars/${userId}/avatar-${Date.now()}-${randomBytes(4).toString("hex")}`;
  const dataUri = `data:${mimeType};base64,${buffer.toString("base64")}`;
  const result = await cloudinary.uploader.upload(dataUri, {
    public_id: publicId,
    resource_type: "image",
    format: "webp",
    allowed_formats: ["webp"],
    use_filename: false,
    overwrite: false,
  });
  return { secureUrl: result.secure_url, publicId: result.public_id ?? publicId };
}

/** Best-effort avatar asset deletion, restricted to our canonical avatar folder. */
export async function deleteAsset(publicId: string): Promise<void> {
  if (!configured() || !/^avatars\/[0-9a-f-]{36}\/[^/]+$/.test(publicId)) return;
  configureCloudinary();
  await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
}

/** Derive a deletable public id only from one of our own canonical avatar URLs. */
export function publicIdFromOwnAvatarUrl(url: string): string | null {
  const name = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  if (!name) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "res.cloudinary.com") return null;
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments[0] !== name || segments[1] !== "image" || segments[2] !== "upload") return null;
    const publicId = segments.slice(3).join("/");
    return /^avatars\/[0-9a-f-]{36}\/[^/]+$/.test(publicId) ? publicId : null;
  } catch {
    return null;
  }
}
