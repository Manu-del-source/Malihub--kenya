import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("product and chat image controls use the authenticated server uploader", async () => {
  const [product, chat, helper] = await Promise.all([
    readFile(new URL("../src/components/marketplace/image-upload-grid.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/messaging/message-input.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/client-image-upload.ts", import.meta.url), "utf8"),
  ]);
  assert.match(product, /uploadImageFile\(file, "product"\)/);
  assert.match(chat, /uploadImageFile\(file, "message"\)/);
  assert.match(helper, /\/api\/uploads\/images/);
  assert.doesNotMatch(product, /CldUploadWidget/);
  assert.doesNotMatch(chat, /CldUploadWidget/);
});
