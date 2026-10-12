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

/**
 * True if `url` is an IMAGE delivery from *our* Cloudinary account.
 *
 * A Cloudinary delivery URL is
 * `https://res.cloudinary.com/<cloud>/<resource-type>/...` — the segment
 * after the cloud name is the resource type (`image`, `raw`, `video`). Only
 * `image` is accepted here: a `/raw/` or `/video/` URL would let an unsigned
 * preset upload (or a dashboard misconfiguration) serve arbitrary files from
 * our own CDN hostname, which the bare `isOwnCloudinaryUrl` check would pass.
 */
export function isOwnCloudinaryImageUrl(url: string): boolean {
  if (!isOwnCloudinaryUrl(url)) return false;
  const cloudName = getCloudinaryCloudName();
  if (!cloudName) return false;
  try {
    const parsed = new URL(url);
    const afterCloud = parsed.pathname.slice(`/${cloudName}/`.length);
    return afterCloud.split("/")[0] === "image";
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

/**
 * True if `url` is an avatar produced by the app's own server-side uploader:
 * an IMAGE delivery from our Cloudinary account under the `avatars/` folder
 * (`https://res.cloudinary.com/<cloud>/image/upload/avatars/<userId>/…`).
 *
 * This is the canonical avatar shape after the Supabase Storage removal.
 * Legacy avatars — still in the Supabase `avatars` bucket until
 * `scripts/migrate-avatars-to-cloudinary.mjs` has run and been verified in
 * production — keep matching `isOwnSupabaseStorageUrl`; that legacy branch
 * must come out only once the migration is confirmed, so un-migrated
 * profiles remain displayable and valid in the meantime.
 */
export function isOwnCloudinaryAvatarUrl(url: string): boolean {
  if (!isOwnCloudinaryImageUrl(url)) return false;
  const cloudName = getCloudinaryCloudName();
  if (!cloudName) return false;

  try {
    const parsed = new URL(url);
    const afterCloud = parsed.pathname.slice(`/${cloudName}/`.length);
    const segments = afterCloud.split("/");
    // image / upload / avatars / <userId> / <file>
    return segments[0] === "image" && segments[1] === "upload" && segments[2] === "avatars";
  } catch {
    return false;
  }
}
