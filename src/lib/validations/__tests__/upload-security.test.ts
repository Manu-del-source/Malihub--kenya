import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

/**
 * Regression tests for the URL validators behind the upload surface
 * (ASA-FILE-001). The unsigned Cloudinary preset and the public Supabase
 * anon key mean a client can upload to (or reference) files it should not be
 * able to use — these validators are the server-side gate that decides which
 * URLs may actually be STORED on listings, chat messages and profiles.
 *
 * The validators read the environment at call time, so each test controls
 * the exact configuration it is asserting against.
 */

import {
  isOwnCloudinaryUrl,
  isOwnCloudinaryImageUrl,
  isOwnCloudinaryAvatarUrl,
  isOwnSupabaseStorageUrl,
} from "@/lib/validations/upload-security";
import { listingImageSchema, listingSchema } from "@/lib/validations/listing";
import { sendMessageSchema, editMessageSchema } from "@/lib/validations/chat";
import { completeProfileSchema } from "@/lib/validations/auth";

const CLOUD = "malihub-kenya";
const SUPABASE_URL = "https://sb-proj.supabase.co";

const OWN_IMAGE = `https://res.cloudinary.com/${CLOUD}/image/upload/v1/photo.jpg`;
const OTHER_TENANT_IMAGE =
  "https://res.cloudinary.com/someone-elses-cloud/image/upload/v1/photo.jpg";
const OWN_RAW = `https://res.cloudinary.com/${CLOUD}/raw/upload/v1/payload.html`;
const OWN_VIDEO = `https://res.cloudinary.com/${CLOUD}/video/upload/v1/clip.mp4`;
const NO_TYPE_SEGMENT = `https://res.cloudinary.com/${CLOUD}/probox.jpg`;
const EXTERNAL = "https://example.com/image/upload/v1/photo.jpg";

const OWN_AVATAR = `${SUPABASE_URL}/storage/v1/object/public/avatars/me.png`;
const OTHER_PROJECT_AVATAR =
  "https://other-project.supabase.co/storage/v1/object/public/avatars/me.png";

const saved = {
  cloud: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  supabase: process.env.NEXT_PUBLIC_SUPABASE_URL,
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = CLOUD;
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
});

afterEach(() => {
  for (const [key, value] of Object.entries({
    NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: saved.cloud,
    NEXT_PUBLIC_SUPABASE_URL: saved.supabase,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("isOwnCloudinaryUrl", () => {
  it("accepts a delivery from our own cloud", () => {
    assert.equal(isOwnCloudinaryUrl(OWN_IMAGE), true);
  });

  it("rejects another tenant's cloud on the same hostname", () => {
    assert.equal(isOwnCloudinaryUrl(OTHER_TENANT_IMAGE), false);
  });

  it("rejects non-Cloudinary hosts", () => {
    assert.equal(isOwnCloudinaryUrl(EXTERNAL), false);
  });

  it("rejects insecure URLs, credentials, and nonstandard ports", () => {
    assert.equal(isOwnCloudinaryUrl(OWN_IMAGE.replace("https:", "http:")), false);
    assert.equal(isOwnCloudinaryUrl(OWN_IMAGE.replace("https://", "https://user@")), false);
    assert.equal(isOwnCloudinaryUrl(OWN_IMAGE.replace(".com/", ".com:8443/")), false);
  });

  it("fails closed when the cloud name is unconfigured", () => {
    delete process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    assert.equal(isOwnCloudinaryUrl(OWN_IMAGE), false);
  });
});

describe("isOwnCloudinaryImageUrl", () => {
  it("accepts an /image/ delivery from our cloud", () => {
    assert.equal(isOwnCloudinaryImageUrl(OWN_IMAGE), true);
  });

  it("rejects a /raw/ delivery — arbitrary files must not be storable", () => {
    assert.equal(isOwnCloudinaryImageUrl(OWN_RAW), false);
  });

  it("rejects a /video/ delivery", () => {
    assert.equal(isOwnCloudinaryImageUrl(OWN_VIDEO), false);
  });

  it("rejects a remote-fetch URL that is not an uploaded image", () => {
    const fetchUrl = `https://res.cloudinary.com/${CLOUD}/image/fetch/https://example.com/image.jpg`;
    assert.equal(isOwnCloudinaryImageUrl(fetchUrl), false);
  });

  it("rejects a delivery with no recognizable image type segment", () => {
    assert.equal(isOwnCloudinaryImageUrl(NO_TYPE_SEGMENT), false);
  });

  it("rejects another tenant even for an image delivery", () => {
    assert.equal(isOwnCloudinaryImageUrl(OTHER_TENANT_IMAGE), false);
  });

  it("fails closed when the cloud name is unconfigured", () => {
    delete process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    assert.equal(isOwnCloudinaryImageUrl(OWN_IMAGE), false);
  });
});

describe("isOwnSupabaseStorageUrl", () => {
  it("accepts a public-storage file from our project", () => {
    assert.equal(isOwnSupabaseStorageUrl(OWN_AVATAR), true);
  });

  it("rejects another project's storage on a different host", () => {
    assert.equal(isOwnSupabaseStorageUrl(OTHER_PROJECT_AVATAR), false);
  });

  it("fails closed when the Supabase URL is unconfigured", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    assert.equal(isOwnSupabaseStorageUrl(OWN_AVATAR), false);
  });
});

describe("listing image validation (stored through the listing schema)", () => {
  it("accepts a photo returned by the in-app uploader", () => {
    const result = listingImageSchema.safeParse({
      url: OWN_IMAGE,
      cloudinaryId: "image/upload/v1/photo.jpg",
    });
    assert.equal(result.success, true);
  });

  it("rejects an arbitrary external URL", () => {
    const result = listingImageSchema.safeParse({ url: EXTERNAL, cloudinaryId: "x" });
    assert.equal(result.success, false);
  });

  it("rejects another tenant's Cloudinary image", () => {
    const result = listingImageSchema.safeParse({
      url: OTHER_TENANT_IMAGE,
      cloudinaryId: "image/upload/v1/photo.jpg",
    });
    assert.equal(result.success, false);
  });

  it("rejects a /raw/ delivery of our own cloud", () => {
    const result = listingImageSchema.safeParse({ url: OWN_RAW, cloudinaryId: "raw/upload/v1/x" });
    assert.equal(result.success, false);
  });

  it("rejects a public_id longer than the sane bound", () => {
    const result = listingImageSchema.safeParse({
      url: OWN_IMAGE,
      cloudinaryId: "a".repeat(301),
    });
    assert.equal(result.success, false);
  });

  it("fails closed for every image when the cloud name is unconfigured", () => {
    delete process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    const base = {
      title: "A reasonably long product title here",
      description: "A sufficiently long description for the schema to accept it.",
      categorySlug: "electronics",
      condition: "GOOD" as const,
      priceCents: 10000,
      quantity: 1,
      county: "Nairobi" as const,
      town: "Nairobi CBD",
      images: [{ url: OWN_IMAGE, cloudinaryId: "image/upload/v1/photo.jpg" }],
    };
    assert.equal(listingSchema.safeParse(base).success, false);
  });
});

describe("chat message image validation", () => {
  const base = { chatId: "00000000-0000-4000-8000-000000000000", content: "hello" };

  it("accepts an own-cloud image attachment", () => {
    const result = sendMessageSchema.safeParse({ ...base, imageUrl: OWN_IMAGE });
    assert.equal(result.success, true);
  });

  it("rejects another tenant's image", () => {
    const result = sendMessageSchema.safeParse({ ...base, imageUrl: OTHER_TENANT_IMAGE });
    assert.equal(result.success, false);
  });

  it("rejects a /raw/ delivery", () => {
    const result = sendMessageSchema.safeParse({ ...base, imageUrl: OWN_RAW });
    assert.equal(result.success, false);
  });

  it("rejects an external URL", () => {
    const result = sendMessageSchema.safeParse({ ...base, imageUrl: EXTERNAL });
    assert.equal(result.success, false);
  });

  it("still allows a text-only message", () => {
    const result = sendMessageSchema.safeParse(base);
    assert.equal(result.success, true);
  });

  it("editMessage keeps the same gate on the content", () => {
    const result = editMessageSchema.safeParse({
      messageId: "00000000-0000-4000-8000-000000000000",
      content: "edited",
    });
    assert.equal(result.success, true);
  });
});

describe("isOwnCloudinaryAvatarUrl", () => {
  const CANONICAL = `https://res.cloudinary.com/${CLOUD}/image/upload/avatars/me/avatar.png`;

  it("accepts the canonical app-produced avatar shape", () => {
    assert.equal(isOwnCloudinaryAvatarUrl(CANONICAL), true);
  });

  it("rejects another tenant's cloud", () => {
    assert.equal(
      isOwnCloudinaryAvatarUrl("https://res.cloudinary.com/elsewhere/image/upload/avatars/me/a.png"),
      false
    );
  });

  it("rejects our cloud but a non-avatar folder (e.g. listings)", () => {
    assert.equal(
      isOwnCloudinaryAvatarUrl(`https://res.cloudinary.com/${CLOUD}/image/upload/listings/me/a.png`),
      false
    );
  });

  it("rejects a /raw/ delivery even under the avatars folder", () => {
    assert.equal(
      isOwnCloudinaryAvatarUrl(`https://res.cloudinary.com/${CLOUD}/raw/upload/avatars/me/a.png`),
      false
    );
  });

  it("fails closed when the cloud name is unconfigured", () => {
    delete process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    assert.equal(isOwnCloudinaryAvatarUrl(CANONICAL), false);
  });
});

describe("profile avatar validation", () => {
  const base = {
    fullName: "Amina Yusuf",
    phone: "0712345678",
    county: "Nairobi" as const,
    accountIntent: "BUYER" as const,
  };
  const CLOUDINARY_AVATAR = `https://res.cloudinary.com/${CLOUD}/image/upload/avatars/me/avatar.png`;

  it("accepts a photo from our Supabase storage (legacy, pre-migration)", () => {
    const result = completeProfileSchema.safeParse({ ...base, avatarUrl: OWN_AVATAR });
    assert.equal(result.success, true);
  });

  it("accepts a photo from our Cloudinary avatars folder (canonical)", () => {
    const result = completeProfileSchema.safeParse({ ...base, avatarUrl: CLOUDINARY_AVATAR });
    assert.equal(result.success, true);
  });

  it("accepts an empty avatar (no photo yet)", () => {
    const result = completeProfileSchema.safeParse({ ...base, avatarUrl: "" });
    assert.equal(result.success, true);
  });

  it("rejects another project's storage URL", () => {
    const result = completeProfileSchema.safeParse({ ...base, avatarUrl: OTHER_PROJECT_AVATAR });
    assert.equal(result.success, false);
  });

  it("rejects our Cloudinary but a non-avatar folder", () => {
    const result = completeProfileSchema.safeParse({
      ...base,
      avatarUrl: `https://res.cloudinary.com/${CLOUD}/image/upload/listings/me/a.png`,
    });
    assert.equal(result.success, false);
  });

  it("rejects an arbitrary external URL", () => {
    const result = completeProfileSchema.safeParse({ ...base, avatarUrl: EXTERNAL });
    assert.equal(result.success, false);
  });

  it("fails closed when both Supabase and Cloudinary are unconfigured", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    const legacy = completeProfileSchema.safeParse({ ...base, avatarUrl: OWN_AVATAR });
    const canonical = completeProfileSchema.safeParse({ ...base, avatarUrl: CLOUDINARY_AVATAR });
    assert.equal(legacy.success, false);
    assert.equal(canonical.success, false);
  });
});
