import { before, it, mock } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

mock.module("server-only", { namedExports: {} });
let sanitizeImageBuffer: typeof import("@/lib/validations/sanitize-image").sanitizeImageBuffer;
before(async () => {
  ({ sanitizeImageBuffer } = await import("@/lib/validations/sanitize-image"));
});

it("decodes an image and returns a newly encoded WebP", async () => {
  const input = await sharp({ create: { width: 16, height: 12, channels: 3, background: "orange" } }).jpeg().toBuffer();
  const output = await sanitizeImageBuffer(input, "image/jpeg", { maxBytes: 1_000_000, maxDimension: 2000 });
  assert.equal(output.mimeType, "image/webp");
  assert.equal((await sharp(output.buffer).metadata()).format, "webp");
});

it("rejects truncated image data", async () => {
  const input = await sharp({ create: { width: 16, height: 12, channels: 3, background: "orange" } }).jpeg().toBuffer();
  await assert.rejects(sanitizeImageBuffer(input.subarray(0, 12), "image/jpeg", { maxBytes: 1_000_000, maxDimension: 2000 }));
});
