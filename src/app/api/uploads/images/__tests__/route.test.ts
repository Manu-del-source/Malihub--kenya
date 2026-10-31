import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 1, 2, 3]);
let session: { id: string } | null = { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" };
let redisAvailable = true;
let sellerVerified = true;
let rateAllowed = true;
const stored: Array<{ buffer: Buffer; purpose: string }> = [];
class TestImageValidationError extends Error {}

mock.module("server-only", { namedExports: {} });
mock.module("@/lib/auth", { namedExports: { getCurrentUser: async () => session ? { user: session } : null } });
mock.module("@/lib/redis", { namedExports: { getRedis: () => redisAvailable ? {} : null } });
mock.module("@/lib/cloudinary-usage", { namedExports: { assertCloudinaryUploadsAllowed: async () => {} } });
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
      return { secureUrl: "https://res.cloudinary.com/test/image/upload/malihub/photo.webp", publicId: "malihub/photo" };
    },
  },
});
mock.module("@/lib/safe-log", { namedExports: { logServerError: () => {} } });

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
  session = { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" };
  redisAvailable = true;
  sellerVerified = true;
  rateAllowed = true;
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
  it("stores only sanitized WebP output for product photos", async () => {
    const response = await route.POST(makeRequest("product", JPEG));
    assert.equal(response.status, 200);
    assert.equal(stored[0]!.purpose, "product");
    assert.equal(stored[0]!.buffer.toString(), "clean-webp");
    const body = await response.json();
    assert.equal(body.data.format, "webp");
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
