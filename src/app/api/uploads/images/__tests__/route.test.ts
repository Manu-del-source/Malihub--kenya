import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 1, 2, 3]);
let session: { id: string; role?: string } | null = { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", role: "SELLER" };
let redisAvailable = true;
let sellerVerified = true;
let rateAllowed = true;
let usageProtectionError: Error | null = null;
let cloudinaryUploadError: Error | null = null;
const cloudinaryLogs: Array<{ error: unknown; context: unknown }> = [];
const stored: Array<{ buffer: Buffer; purpose: string }> = [];
class TestImageValidationError extends Error {}

mock.module("server-only", { namedExports: {} });
mock.module("@/lib/auth", { namedExports: { getCurrentUser: async () => session ? { user: session } : null } });
mock.module("@/lib/redis", { namedExports: { getRedis: () => redisAvailable ? {} : null } });
mock.module("@/lib/cloudinary-usage", { namedExports: { assertCloudinaryUploadsAllowed: async () => { if (usageProtectionError) throw usageProtectionError; } } });
mock.module("@/lib/rate-limit", {
  namedExports: {
    rateLimit: {
      listingImageUpload: async () => ({ success: rateAllowed, reset: Date.now() + 60_000 }),
      messageImageUpload: async () => ({ success: rateAllowed, reset: Date.now() + 60_000 }),
    },
    formatRetryAfter: () => "1m",
  },
});
mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      seller: {
        findUnique: async () => sellerVerified ? { id: "seller-1", verificationStatus: "VERIFIED" } : null,
      },
    },
  },
});
mock.module("@/lib/validations/sanitize-image", {
  namedExports: {
    ImageValidationError: TestImageValidationError,
    sanitizeImageBuffer: async (buffer: Buffer, mime: string) => {
      if (!(buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) || mime !== "image/jpeg") {
        throw new TestImageValidationError("Unsupported image content.");
      }
      return { buffer: Buffer.from("clean-webp"), mimeType: "image/webp", width: 10, height: 10, originalKind: "jpeg" };
    },
  },
});
mock.module("@/lib/cloudinary", {
  namedExports: {
    uploadMarketplaceImage: async (buffer: Buffer, purpose: "product" | "message") => {
      stored.push({ buffer, purpose });
      if (cloudinaryUploadError) throw cloudinaryUploadError;
      return { secureUrl: "https://res.cloudinary.com/test/image/upload/malihub/photo.webp", publicId: "malihub/photo" };
    },
  },
});
mock.module("@/lib/safe-log", { namedExports: { logServerError: () => {}, logCloudinaryUploadError: (error: unknown, context: unknown) => { cloudinaryLogs.push({ error, context }); } } });

let route: typeof import("@/app/api/uploads/images/route");
function makeRequest(purpose: string, bytes: Uint8Array, mime = "image/jpeg", origin = "http://localhost:3000") {
  const form = new FormData();
  form.set("purpose", purpose);
  form.set("file", new File([bytes], "photo.jpg", { type: mime }));
  return new NextRequest("http://localhost:3000/api/uploads/images", {
    method: "POST",
    headers: { host: "localhost:3000", origin },
    body: form,
  });
}

before(async () => { route = await import("@/app/api/uploads/images/route"); });
beforeEach(() => {
  session = { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", role: "SELLER" };
  redisAvailable = true;
  sellerVerified = true;
  rateAllowed = true;
  usageProtectionError = null;
  cloudinaryUploadError = null;
  cloudinaryLogs.length = 0;
  stored.length = 0;
});

describe("authenticated image upload endpoint", () => {
  it("requires a signed-in user", async () => {
    session = null;
    const response = await route.POST(makeRequest("message", JPEG));
    assert.equal(response.status, 401);
    assert.equal(stored.length, 0);
  });
  it("rejects cross-origin requests", async () => {
    const response = await route.POST(makeRequest("message", JPEG, "image/jpeg", "https://outside.example"));
    assert.equal(response.status, 403);
  });
  it("fails closed if Redis is unavailable", async () => {
    redisAvailable = false;
    const response = await route.POST(makeRequest("message", JPEG));
    assert.equal(response.status, 503);
  });
  it("accepts only files passing the sanitizer", async () => {
    const response = await route.POST(makeRequest("message", new Uint8Array([1, 2, 3])));
    assert.equal(response.status, 415);
    assert.equal(stored.length, 0);
  });
  it("requires verified sellers for product photos", async () => {
    sellerVerified = false;
    const response = await route.POST(makeRequest("product", JPEG));
    assert.equal(response.status, 403);
  });
  it("allows SUPER_ADMIN to upload official product photos without a seller profile", async () => {
    session = { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", role: "SUPER_ADMIN" };
    sellerVerified = false;
    const response = await route.POST(makeRequest("product", JPEG));
    assert.equal(response.status, 200);
    assert.equal(stored[0]!.purpose, "product");
  });
  it("allows SUPER_ADMIN to continue when usage verification is temporarily unavailable", async () => {
    session = { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", role: "SUPER_ADMIN" };
    usageProtectionError = new Error("Upstash Redis is required for Cloudinary upload safeguards.");
    const response = await route.POST(makeRequest("product", JPEG));
    assert.equal(response.status, 200);
    assert.equal(stored[0]!.purpose, "product");
  });
  it("does not allow ordinary sellers to bypass unavailable usage verification", async () => {
    usageProtectionError = new Error("Upstash Redis is required for Cloudinary upload safeguards.");
    const response = await route.POST(makeRequest("product", JPEG));
    assert.equal(response.status, 503);
    assert.equal(stored.length, 0);
  });
  it("does not allow SUPER_ADMIN to bypass a confirmed usage threshold or emergency pause", async () => {
    session = { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", role: "SUPER_ADMIN" };
    usageProtectionError = new Error("Cloudinary usage has reached the 85% safety threshold.");
    const response = await route.POST(makeRequest("product", JPEG));
    assert.equal(response.status, 503);
    assert.equal(stored.length, 0);
  });
  it("stores only sanitized WebP output for product photos", async () => {
    const response = await route.POST(makeRequest("product", JPEG));
    assert.equal(response.status, 200);
    assert.equal(stored[0]!.purpose, "product");
    assert.equal(stored[0]!.buffer.toString(), "clean-webp");
    const body = await response.json();
    assert.equal(body.data.format, "webp");
  });
  it("returns a trace reference and records Cloudinary provider failures", async () => {
    cloudinaryUploadError = Object.assign(new Error("Invalid API key"), { http_code: 401 });
    const response = await route.POST(makeRequest("product", JPEG));
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.success, false);
    assert.match(body.reference, /^[0-9a-f-]{36}$/i);
    assert.equal(cloudinaryLogs.length, 1);
    assert.deepEqual(cloudinaryLogs[0]!.context, { errorId: body.reference, purpose: "product" });
  });
  it("supports sanitized chat attachments", async () => {
    const response = await route.POST(makeRequest("message", JPEG));
    assert.equal(response.status, 200);
    assert.equal(stored[0]!.purpose, "message");
  });
  it("enforces the upload quota", async () => {
    rateAllowed = false;
    const response = await route.POST(makeRequest("message", JPEG));
    assert.equal(response.status, 429);
    assert.ok(response.headers.get("retry-after"));
    assert.equal(stored.length, 0);
  });
});
