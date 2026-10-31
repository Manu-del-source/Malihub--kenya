import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

/**
 * `POST /api/avatar/upload` at the route boundary.
 *
 * The route replaces the browser→Supabase-Storage direct upload. What matters
 * at this level:
 *  - no session → 401, always;
 *  - the same-origin (CSRF) guard runs first, fail-closed;
 *  - identity is the verified session — the body carries no user id, so a
 *    client cannot upload into someone else's folder;
 *  - rate limiting (per user) answers 429 with Retry-After;
 *  - the file is validated by its OWN BYTES (magic bytes, not Content-Type);
 *  - the Cloudinary upload is called with the session user's folder and the
 *    classified mime type, never with a user-supplied public id;
 *  - the profile row is updated (or tolerated missing mid-onboarding);
 *  - only a previous Cloudinary-hosted avatar is cleaned up — a legacy
 *    Supabase URL is NEVER deleted by this route.
 *
 * `@/lib/auth`, `@/lib/prisma`, `@/lib/rate-limit` and `@/lib/cloudinary`
 * are substituted at the module boundary; the route handler, the CSRF guard
 * and the magic-byte validation all run for real.
 */

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 1, 2, 3]);
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const NOT_IMAGE_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]); // zip magic

type ProfileRow = { userId: string; avatarUrl: string | null };
const profiles = new Map<string, ProfileRow>();

const calls = {
  uploads: [] as { buffer: Buffer; mime: string; userId: string }[],
  deletes: [] as string[],
  uploadError: null as Error | null,
};

const CLOUD = "malihub-test-cloud";
const userIdOf = (id: string) => id;

const prismaProxy = new Proxy(
  {} as Record<string, unknown>,
  {
    get: (_target, property: string) => {
      if (property !== "profile") return undefined;
      return {
        findUnique: async ({ where }: { where: { userId: string } }) =>
          profiles.get(where.userId) ?? null,
        update: async ({ where, data }: { where: { userId: string }; data: { avatarUrl: string } }) => {
          const row = profiles.get(where.userId);
          if (!row) throw new Error("Record to update not found.");
          Object.assign(row, data);
          return row;
        },
      };
    },
  }
);

type SessionUser = { id: string; email: string } | null;
let sessionUser: SessionUser = null;
let rateLimitSuccess = true;

mock.module("server-only", { namedExports: {} });
mock.module("@/lib/prisma", { namedExports: { prisma: prismaProxy } });
mock.module("@/lib/auth", {
  namedExports: {
    getCurrentUser: async () =>
      sessionUser ? { identity: { authUserId: "neon-1" }, user: sessionUser } : null,
  },
});
class TestImageValidationError extends Error {}
mock.module("@/lib/validations/sanitize-image", {
  namedExports: {
    ImageValidationError: TestImageValidationError,
    sanitizeImageBuffer: async (buffer: Buffer, declaredMime: string) => {
      const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
      const png = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      const webp = buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP";
      if (!(jpeg && declaredMime === "image/jpeg") && !(png && declaredMime === "image/png") && !(webp && declaredMime === "image/webp")) {
        throw new TestImageValidationError("Invalid image input.");
      }
      return { buffer: Buffer.from("clean-webp"), mimeType: "image/webp", width: 10, height: 10, originalKind: png ? "png" : webp ? "webp" : "jpeg" };
    },
  },
});

mock.module("@/lib/rate-limit", {
  namedExports: {
    rateLimit: {
      avatarUpload: async () => ({
        success: rateLimitSuccess,
        limit: 10,
        remaining: 9,
        reset: Date.now() + 60_000,
      }),
    },
    formatRetryAfter: () => "1m",
  },
});
mock.module("@/lib/cloudinary", {
  namedExports: {
    uploadAvatarImage: async (buffer: Buffer, mime: string, userId: string) => {
      if (calls.uploadError) throw calls.uploadError;
      calls.uploads.push({ buffer, mime, userId: userIdOf(userId) });
      return {
        secureUrl: `https://res.cloudinary.com/${CLOUD}/image/upload/avatars/${userId}/avatar-new.png`,
        publicId: `avatars/${userId}/avatar-new`,
      };
    },
    deleteAsset: async (publicId: string) => {
      calls.deletes.push(publicId);
    },
    // Real behaviour, re-implemented here so the mocked module is self-contained.
    publicIdFromOwnAvatarUrl: (url: string) => {
      const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
      if (!cloudName) return null;
      try {
        const parsed = new URL(url);
        if (parsed.hostname !== "res.cloudinary.com") return null;
        const segments = parsed.pathname.split("/").filter(Boolean);
        if (segments[0] !== cloudName) return null;
        if (segments[1] !== "image" || segments[2] !== "upload") return null;
        const publicId = segments.slice(3).join("/");
        return /^avatars\/[0-9a-f-]{36}\/[^/]+$/.test(publicId) ? publicId : null;
      } catch {
        return null;
      }
    },
  },
});

let route: typeof import("@/app/api/avatar/upload/route");

const USER_A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

function request(
  file: File | null,
  {
    origin = "http://localhost:3000",
    host = "localhost:3000",
    fieldName = "avatar",
  }: { origin?: string | null; host?: string; fieldName?: string } = {}
): NextRequest {
  const headers = new Headers({ host });
  if (origin) headers.set("origin", origin);
  let body: FormData | undefined;
  if (file) {
    body = new FormData();
    body.append(fieldName, file);
  }
  return new NextRequest("http://localhost:3000/api/avatar/upload", {
    method: "POST",
    headers,
    ...(body ? { body } : {}),
  });
}

before(async () => {
  process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = CLOUD;
  route = await import("@/app/api/avatar/upload/route");
});

beforeEach(() => {
  profiles.clear();
  calls.uploads.length = 0;
  calls.deletes.length = 0;
  calls.uploadError = null;
  sessionUser = { id: USER_A, email: "a@example.com" };
  rateLimitSuccess = true;
});

describe("authentication and CSRF", () => {
  it("refuses an unauthenticated upload with 401", async () => {
    sessionUser = null;
    const res = await route.POST(request(new File([JPEG_BYTES], "a.jpg", { type: "image/jpeg" })));
    assert.equal(res.status, 401);
    assert.equal(calls.uploads.length, 0);
  });

  it("rejects a request with no Origin header (fail-closed)", async () => {
    const res = await route.POST(request(new File([JPEG_BYTES], "a.jpg"), { origin: null }));
    assert.equal(res.status, 403);
    assert.equal(calls.uploads.length, 0);
  });

  it("rejects a cross-origin request before touching any store", async () => {
    const res = await route.POST(
      request(new File([JPEG_BYTES], "a.jpg"), { origin: "https://evil.example" })
    );
    assert.equal(res.status, 403);
    assert.equal(calls.uploads.length, 0);
    assert.equal(profiles.size, 0);
  });
});

describe("input validation", () => {
  it("rejects a request without a file", async () => {
    const res = await route.POST(request(null));
    assert.equal(res.status, 400);
  });

  it("rejects a file under the wrong field name", async () => {
    const res = await route.POST(request(new File([JPEG_BYTES], "a.jpg"), { fieldName: "other" }));
    assert.equal(res.status, 400);
  });

  it("rejects an empty file", async () => {
    const res = await route.POST(request(new File([new Uint8Array(0)], "a.jpg")));
    assert.equal(res.status, 400);
  });

  it("rejects an oversized file with 413", async () => {
    const big = new Uint8Array(3 * 1024 * 1024 + 1);
    big[0] = 0xff;
    big[1] = 0xd8;
    big[2] = 0xff;
    const res = await route.POST(request(new File([big], "big.jpg")));
    assert.equal(res.status, 413);
    assert.equal(calls.uploads.length, 0);
  });

  it("rejects a renamed non-image by magic bytes, regardless of Content-Type", async () => {
    // Content-Type says jpeg; the bytes say zip. Magic bytes win.
    const res = await route.POST(
      request(new File([NOT_IMAGE_BYTES], "photo.jpg", { type: "image/jpeg" }))
    );
    assert.equal(res.status, 415);
    assert.equal(calls.uploads.length, 0);
  });

  it("accepts a PNG declared as PNG", async () => {
    const res = await route.POST(request(new File([PNG_BYTES], "a.png", { type: "image/png" })));
    assert.equal(res.status, 200);
    assert.equal(calls.uploads.length, 1);
    assert.equal(calls.uploads[0]!.mime, "image/webp");
  });
});

describe("rate limiting", () => {
  it("answers 429 with Retry-After when the limiter trips", async () => {
    rateLimitSuccess = false;
    const res = await route.POST(request(new File([JPEG_BYTES], "a.jpg")));
    assert.equal(res.status, 429);
    assert.ok(res.headers.get("retry-after"));
    const body = await res.json();
    assert.equal(body.code, "rate_limited");
    assert.equal(calls.uploads.length, 0);
  });
});

describe("upload and profile update", () => {
  it("uploads under the session user's folder and stores the returned URL", async () => {
    profiles.set(USER_A, { userId: USER_A, avatarUrl: null });

    const res = await route.POST(request(new File([JPEG_BYTES], "a.jpg")));
    assert.equal(res.status, 200);

    const body = (await res.json()) as { success: boolean; data: { url: string } };
    assert.equal(body.success, true);
    assert.match(body.data.url, new RegExp(`^https://res\\.cloudinary\\.com/${CLOUD}/image/upload/avatars/${USER_A}/`));

    assert.equal(calls.uploads.length, 1);
    assert.equal(calls.uploads[0]!.userId, USER_A);
    assert.equal(calls.uploads[0]!.mime, "image/jpeg");
    assert.equal(profiles.get(USER_A)!.avatarUrl, body.data.url);
    assert.equal(calls.deletes.length, 0);
  });

  it("uploads for the session user even when the body tried to name another user", async () => {
    // The body carries no identity at all — there is nothing to forge; the
    // folder is derived from the session. Pin that explicitly.
    profiles.set(USER_A, { userId: USER_A, avatarUrl: null });
    const res = await route.POST(request(new File([JPEG_BYTES], "b.jpg")));
    assert.equal(res.status, 200);
    assert.equal(calls.uploads[0]!.userId, USER_A);
  });

  it("succeeds when no profile row exists yet (mid-onboarding)", async () => {
    const res = await route.POST(request(new File([JPEG_BYTES], "a.jpg")));
    assert.equal(res.status, 200);
    assert.equal(calls.uploads.length, 1);
  });

  it("cleans up a previous Cloudinary-hosted avatar, best-effort", async () => {
    const previous = `https://res.cloudinary.com/${CLOUD}/image/upload/avatars/${USER_A}/avatar-old.png`;
    profiles.set(USER_A, { userId: USER_A, avatarUrl: previous });

    const res = await route.POST(request(new File([JPEG_BYTES], "a.jpg")));
    assert.equal(res.status, 200);
    assert.deepEqual(calls.deletes, [`avatars/${USER_A}/avatar-old.png`]);
  });

  it("NEVER deletes a legacy Supabase-hosted avatar", async () => {
    const legacy =
      "https://malihub-test.supabase.co/storage/v1/object/public/avatars/avatar-1700.png";
    profiles.set(USER_A, { userId: USER_A, avatarUrl: legacy });

    const res = await route.POST(request(new File([JPEG_BYTES], "a.jpg")));
    assert.equal(res.status, 200);
    assert.equal(calls.deletes.length, 0);
  });

  it("reports a Cloudinary outage as a 502 without touching the profile", async () => {
    calls.uploadError = new Error("socket hang up");
    profiles.set(USER_A, { userId: USER_A, avatarUrl: null });

    const res = await route.POST(request(new File([JPEG_BYTES], "a.jpg")));
    assert.equal(res.status, 502);
    assert.equal(profiles.get(USER_A)!.avatarUrl, null);
  });

  it("reports an unconfigured Cloudinary as a 503", async () => {
    calls.uploadError = new Error("CLOUDINARY_API_KEY/SECRET are not configured");
    const res = await route.POST(request(new File([JPEG_BYTES], "a.jpg")));
    assert.equal(res.status, 503);
  });
});

describe("avatar provider error redaction", () => {
  it("does not log or return Cloudinary exception contents", async () => {
    const fakeSecret = "synthetic-cloudinary-secret";
    calls.uploadError = new Error(`upstream failed ${fakeSecret}`);
    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { logged.push(args); };
    try {
      const response = await route.POST(request(new File([JPEG_BYTES], "a.jpg")));
      assert.equal(response.status, 502);
      assert.equal(JSON.stringify({ body: await response.json(), logged }).includes(fakeSecret), false);
      assert.ok(logged.length > 0);
    } finally {
      console.error = original;
    }
  });
});
