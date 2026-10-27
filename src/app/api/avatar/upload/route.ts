import { logServerError } from "@/lib/safe-log";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { verifySameOrigin } from "@/lib/csrf";
import {
  deleteAsset,
  publicIdFromOwnAvatarUrl,
  uploadAvatarImage,
} from "@/lib/cloudinary";
import { prisma } from "@/lib/prisma";
import { formatRetryAfter, rateLimit } from "@/lib/rate-limit";
import { classifyImageMagic, mimeTypeFor } from "@/lib/validations/image-file";

/**
 * `POST /api/avatar/upload` — server-side, authenticated avatar upload.
 *
 * Replaces the browser→Supabase-Storage direct upload (anon key + bucket RLS
 * as the only gate). The whole path is owned by the session:
 *
 *  - fail-closed same-origin check (the repo's CSRF pattern, `src/lib/csrf.ts`);
 *  - identity is the verified Neon Auth session — the body carries no user id,
 *    so a client cannot upload into someone else's folder;
 *  - per-user rate limit (10/hour — provider spend bound; fail-open without
 *    Redis like every other limiter in `src/lib/rate-limit.ts`);
 *  - the file is validated by its OWN BYTES (magic bytes, not Content-Type):
 *    JPEG/PNG/WebP only, ≤ 3 MB (the old bucket's limit, kept for UX parity);
 *  - the upload is an authenticated Cloudinary API call with a
 *    server-generated public id under `avatars/<userId>/` — no preset, no
 *    user-supplied public id, no arbitrary URL;
 *  - the profile row is updated in the same request (a user can only ever
 *    replace their own avatar);
 *  - a previous Cloudinary-hosted avatar is deleted best-effort; legacy
 *    Supabase URLs are NEVER deleted here (the migration's job, and only
 *    after verification — see scripts/migrate-avatars-to-cloudinary.mjs).
 *
 * The returned `res.cloudinary.com/…` URL is exactly what the form stores on
 * the profile; `isOwnCloudinaryAvatarUrl` in the validation layer accepts
 * precisely this shape.
 */

const MAX_AVATAR_BYTES = 3 * 1024 * 1024; // 3 MB — matches the old bucket + the UI copy

function notConfigured(): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: "Avatar uploads are not configured yet — please try again later.",
    },
    { status: 503 }
  );
}

export async function POST(request: NextRequest) {
  const originCheck = verifySameOrigin(request);
  if (originCheck) return originCheck;

  const current = await getCurrentUser();
  const user = current?.user;
  if (!user) {
    return NextResponse.json({ success: false, error: "Sign in required." }, { status: 401 });
  }
  const userId = user.id;

  const limit = await rateLimit.avatarUpload(userId);
  if (!limit.success) {
    return NextResponse.json(
      {
        success: false,
        error: `Too many avatar uploads. Try again ${formatRetryAfter(limit.reset)}.`,
        code: "rate_limited",
      },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((limit.reset - Date.now()) / 1000)) },
      }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { success: false, error: "Expected a multipart file upload." },
      { status: 400 }
    );
  }

  const file = form.get("avatar");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { success: false, error: "No avatar file was received." },
      { status: 400 }
    );
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return NextResponse.json(
      { success: false, error: "Image must be under 3MB." },
      { status: 413 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const kind = classifyImageMagic(buffer);
  if (!kind) {
    // Content-Type is never trusted: a renamed text file with a forged
    // header fails the magic-byte check and stops here.
    return NextResponse.json(
      { success: false, error: "Please choose a JPEG, PNG, or WebP image." },
      { status: 415 }
    );
  }

  let previousPublicId: string | null;
  try {
    const profile = await prisma.profile.findUnique({
      where: { userId },
      select: { avatarUrl: true },
    });
    previousPublicId = profile?.avatarUrl ? publicIdFromOwnAvatarUrl(profile.avatarUrl) : null;
  } catch (error) {
    logServerError("[avatar] could not read current profile", error);
    return NextResponse.json(
      { success: false, error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }

  let uploaded;
  try {
    uploaded = await uploadAvatarImage(buffer, mimeTypeFor(kind), userId);
  } catch (error) {
    logServerError("[avatar] cloudinary upload failed", error);
    if (String(error).includes("not configured")) return notConfigured();
    return NextResponse.json(
      { success: false, error: "Couldn't upload that photo — please try again." },
      { status: 502 }
    );
  }

  try {
    await prisma.profile.update({
      where: { userId },
      data: { avatarUrl: uploaded.secureUrl },
    });
  } catch {
    // No profile row yet (mid-onboarding): the form that invoked this upload
    // stores the returned URL and creates the profile itself. The uploaded
    // asset is valid either way.
  }

  // Best-effort cleanup of the previous avatar, Cloudinary-hosted ones only.
  // Failures are logged and swallowed by design: cleanup must never break the
  // upload that replaced it.
  if (previousPublicId) {
    try {
      await deleteAsset(previousPublicId);
    } catch (error) {
      logServerError("[avatar] previous-avatar cleanup failed", error);
    }
  }

  return NextResponse.json({ success: true, data: { url: uploaded.secureUrl } });
}
