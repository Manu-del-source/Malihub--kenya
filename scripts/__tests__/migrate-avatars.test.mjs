import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  classifyImageMagic,
  deriveLegacyAvatarPublicId,
  isCloudinaryAvatarUrl,
  isSupabaseProjectFileUrl,
  loadMapping,
  saveMapping,
} from "../migrate-avatars-to-cloudinary.mjs";

const SUPABASE = "https://malihub-test.supabase.co";
const CLOUD = "malihub-test-cloud";

describe("isSupabaseProjectFileUrl", () => {
  it("accepts a public object URL of the own project", () => {
    assert.equal(
      isSupabaseProjectFileUrl(
        "https://malihub-test.supabase.co/storage/v1/object/public/avatars/user-1/avatar.png",
        SUPABASE
      ),
      true
    );
  });

  it("refuses another Supabase project (same path shape)", () => {
    assert.equal(
      isSupabaseProjectFileUrl(
        "https://evil-project.supabase.co/storage/v1/object/public/avatars/user-1/avatar.png",
        SUPABASE
      ),
      false
    );
  });

  it("refuses non-storage paths on the own project", () => {
    assert.equal(
      isSupabaseProjectFileUrl("https://malihub-test.supabase.co/rest/v1/x", SUPABASE),
      false
    );
  });

  it("fails closed on garbage input", () => {
    assert.equal(isSupabaseProjectFileUrl("not a url", SUPABASE), false);
    assert.equal(isSupabaseProjectFileUrl(undefined, SUPABASE), false);
    assert.equal(isSupabaseProjectFileUrl("https://x.supabase.co/storage/v1/object/public/a", ""), false);
  });
});

describe("deriveLegacyAvatarPublicId", () => {
  const legacy =
    "https://malihub-test.supabase.co/storage/v1/object/public/avatars/user-1/avatar-1700000000000.png";

  it("derives a stable, deterministic id under avatars/<owner>/", () => {
    const first = deriveLegacyAvatarPublicId(legacy);
    const second = deriveLegacyAvatarPublicId(legacy);
    assert.equal(first, second);
    assert.match(first, /^avatars\/user-1\/migrated-[0-9a-f]{12}$/);
  });

  it("different URLs derive different ids", () => {
    const other =
      "https://malihub-test.supabase.co/storage/v1/object/public/avatars/user-1/avatar-1700000000001.png";
    assert.notEqual(deriveLegacyAvatarPublicId(legacy), deriveLegacyAvatarPublicId(other));
  });

  it("refuses paths that escape the avatars folder", () => {
    assert.equal(
      deriveLegacyAvatarPublicId("https://x.supabase.co/storage/v1/object/public/avatars/..%2f..%2fx/f"),
      null
    );
    assert.equal(
      deriveLegacyAvatarPublicId("https://x.supabase.co/storage/v1/object/public/avatars/a.b/f"),
      null
    );
    assert.equal(
      deriveLegacyAvatarPublicId("https://x.supabase.co/storage/v1/object/public/avatars/f"),
      null
    );
  });

  it("returns null for non-avatars paths and garbage", () => {
    assert.equal(
      deriveLegacyAvatarPublicId("https://x.supabase.co/storage/v1/object/public/listings/a.png"),
      null
    );
    assert.equal(deriveLegacyAvatarPublicId("not a url"), null);
  });
});

describe("isCloudinaryAvatarUrl", () => {
  it("accepts the canonical app-produced shape", () => {
    assert.equal(
      isCloudinaryAvatarUrl(
        `https://res.cloudinary.com/${CLOUD}/image/upload/avatars/user-1/avatar-1.png`,
        CLOUD
      ),
      true
    );
  });

  it("refuses other clouds, folders, and resource types", () => {
    assert.equal(
      isCloudinaryAvatarUrl("https://res.cloudinary.com/other/image/upload/avatars/u/a.png", CLOUD),
      false
    );
    assert.equal(
      isCloudinaryAvatarUrl(
        `https://res.cloudinary.com/${CLOUD}/image/upload/listings/u/a.png`,
        CLOUD
      ),
      false
    );
    assert.equal(
      isCloudinaryAvatarUrl(`https://res.cloudinary.com/${CLOUD}/raw/upload/avatars/u/a.png`, CLOUD),
      false
    );
    assert.equal(isCloudinaryAvatarUrl("garbage", CLOUD), false);
    assert.equal(isCloudinaryAvatarUrl("https://res.cloudinary.com/x/image/upload/avatars/u/a", ""), false);
  });
});

describe("mapping persistence", () => {
  it("round-trips a mapping file and tolerates missing/corrupt files", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "malihub-avatar-map-"));
    const file = path.join(dir, "map.json");

    assert.deepEqual(loadMapping(file), {});
    assert.deepEqual(loadMapping(path.join(dir, "missing.json")), {});

    const mapping = { "https://old/one": "https://res.cloudinary.com/c/image/upload/avatars/u/1" };
    saveMapping(file, mapping);
    assert.deepEqual(loadMapping(file), mapping);

    // Corrupt file → empty mapping, never a crash mid-migration.
    writeFileSync(file, "{not json", "utf8");
    assert.deepEqual(loadMapping(file), {});
  });
});

describe("classifyImageMagic (script copy)", () => {
  it("recognises jpeg/png/webp and rejects the rest", () => {
    assert.equal(classifyImageMagic(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1])), "jpeg");
    assert.equal(
      classifyImageMagic(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
      "png"
    );
    const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
    assert.equal(classifyImageMagic(webp), "webp");
    assert.equal(classifyImageMagic(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 1, 2, 3, 4])), null);
    assert.equal(classifyImageMagic(Uint8Array.from([0xff, 0xd8])), null); // too short
    assert.equal(classifyImageMagic(Uint8Array.from([0x50, 0x4b, 0x03, 0x04])), null); // zip
  });
});
