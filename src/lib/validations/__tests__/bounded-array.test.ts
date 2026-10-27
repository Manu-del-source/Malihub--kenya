import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { MAX_LISTING_IMAGES } from "@/lib/constants";
import { boundedArray } from "@/lib/validations/bounded-array";
import { deliveryCountiesSchema, supplierCreateSchema } from "@/lib/validations/dropshipping";
import { listingSchema } from "@/lib/validations/listing";

describe("bounded array validation", () => {
  it("uses patched Zod to reject oversized bounded arrays before parsing elements", () => {
    let validated = 0;
    const item = z.any().superRefine((_value, ctx) => {
      validated += 1;
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid item" });
    });

    const result = z.array(item).max(2).safeParse(Array(100_000).fill("invalid"));
    assert.equal(result.success, false);
    assert.equal(validated, 0);
    if (!result.success) assert.equal(result.error.issues.length, 1);
  });

  it("does not validate any elements of an oversized array", () => {
    let validated = 0;
    const item = z.any().superRefine((_value, ctx) => {
      validated += 1;
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid item" });
    });
    const schema = boundedArray(z.array(item).max(2), 2, "Too many items");

    const result = schema.safeParse(Array(100_000).fill("invalid"));
    assert.equal(result.success, false);
    assert.equal(validated, 0);
    if (!result.success) {
      assert.equal(result.error.issues.length, 1);
      assert.equal(result.error.issues[0]?.message, "Too many items");
    }
    schema.safeParse(["invalid", "invalid"]);
    assert.equal(validated, 2);
  });

  it("preserves valid values, element errors, type errors, and defaults", () => {
    const schema = boundedArray(z.array(z.number()).max(2), 2).optional().default([]);
    assert.deepEqual(schema.parse(undefined), []);
    assert.deepEqual(schema.parse([1, 2]), [1, 2]);
    assert.equal(schema.safeParse([1, "invalid"]).success, false);
    assert.equal(schema.safeParse("not an array").success, false);
  });

  it("bounds listing photos and supplier counties before validating items", () => {
    const images = listingSchema.shape.images.safeParse(Array(100_000).fill({}));
    const counties = deliveryCountiesSchema.safeParse(Array(100_000).fill("not a county"));
    assert.equal(images.success, false);
    assert.equal(counties.success, false);
    if (!images.success) {
      assert.equal(images.error.issues.length, 1);
      assert.equal(images.error.issues[0]?.message, `Up to ${MAX_LISTING_IMAGES} photos`);
    }
    if (!counties.success) assert.equal(counties.error.issues.length, 1);
    assert.deepEqual(deliveryCountiesSchema.parse(["Nairobi", "Kiambu"]), ["Nairobi", "Kiambu"]);
    assert.deepEqual(supplierCreateSchema.parse({
      name: "Test Supplier",
      slug: "test-supplier",
      region: "KENYA",
      countryCode: "KE",
    }).deliveryCounties, []);
  });
});
