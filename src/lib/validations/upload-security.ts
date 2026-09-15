/**
 * next.config.ts's images.remotePatterns already restricts next/image to
 * a fixed set of hostnames (res.cloudinary.com, *.supabase.co, etc.) —
 * but that only stops arbitrary external domains, not someone referencing
 * another Cloudinary account's or another Supabase project's public
 * files, which would still match the hostname allowlist. These validators
 * close that gap by checking the URL path is actually ours.
 */

function getCloudinaryCloudName(): string | null {
  return process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || null;
}

/** True if `url` is a Cloudinary-delivered asset under *our* cloud name. */
export function isOwnCloudinaryUrl(url: string): boolean {
  const cloudName = getCloudinaryCloudName();
  if (!cloudName) return false;

  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "res.cloudinary.com") return false;
    return parsed.pathname.startsWith(`/${cloudName}/`);
  } catch {
    return false;
  }
}

/** True if `url` is a file in *our* Supabase project's public storage. */
export function isOwnSupabaseStorageUrl(url: string): boolean {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return false;

  try {
    const parsed = new URL(url);
    const expected = new URL(supabaseUrl);
    return parsed.hostname === expected.hostname && parsed.pathname.startsWith("/storage/v1/object/public/");
  } catch {
    return false;
  }
}
