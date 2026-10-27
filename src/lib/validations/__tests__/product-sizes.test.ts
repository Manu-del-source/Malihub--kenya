import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { listingSchema } from "@/lib/validations/listing";
import { isSizeSystem, productSizeLabels, SIZE_SYSTEMS } from "@/lib/product-sizes";

const base = {
  title: "A comfortable shoe", description: "A detailed description of this product.",
  categorySlug: "fashion", condition: "GOOD", brand: "", priceCents: 10000,
  isNegotiable: false, quantity: 1, county: "Nairobi", town: "Westlands", contactPreference: "ANY",
  images: [{ url: "https://res.cloudinary.com/size-test/image/upload/photo.jpg", cloudinaryId: "photo" }],
  status: "DRAFT",
};
before(() => { process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = "size-test"; });

describe("product size validation and display", () => {
  it("accepts and normalizes every supported system", () => {
    for (const sizeSystem of SIZE_SYSTEMS) {
      const parsed = listingSchema.parse({ ...base, size: "  M  ", sizeSystem, availableSizes: " S, M , L , m " });
      assert.equal(parsed.size, "M");
      assert.equal(parsed.sizeSystem, sizeSystem);
      assert.equal(parsed.availableSizes, "S, M, L");
    }
  });
  it("accepts missing/blank sizes and a single size without a system", () => {
    assert.equal(listingSchema.safeParse(base).success, true);
    assert.equal(listingSchema.safeParse({ ...base, size: "", sizeSystem: "", availableSizes: "" }).success, true);
    assert.equal(listingSchema.safeParse({ ...base, size: " 42 " }).success, true);
    assert.equal(listingSchema.safeParse({ ...base, availableSizes: "S, M" }).success, true);
  });
  it("rejects malformed or inconsistent inputs instead of casting", () => {
    for (const fields of [
      { sizeSystem: "WRONG", size: "M" }, { sizeSystem: "UK" }, { size: "M,L" },
      { size: 42 }, { availableSizes: ["S", "M"] }, { availableSizes: "S,,M" },
      { availableSizes: "," }, { availableSizes: Array(21).fill("M").join(",") },
      { availableSizes: "x".repeat(81) }, { size: "M\nL" },
    ]) assert.equal(listingSchema.safeParse({ ...base, ...fields }).success, false, JSON.stringify(fields));
  });
  it("displays size and available sizes with the system, and handles malformed legacy values", () => {
    assert.deepEqual(productSizeLabels({ size: "M", sizeSystem: "CLOTHING", availableSizes: "S, M" }), ["Size: M (Clothing)", "Available sizes: S, M (Clothing)"]);
    assert.deepEqual(productSizeLabels({ availableSizes: " 8, 9 ", sizeSystem: "UK" }), ["Available sizes: 8, 9 (UK)"]);
    assert.deepEqual(productSizeLabels({ size: { value: "M" }, sizeSystem: "WRONG", availableSizes: null }), []);
    assert.equal(isSizeSystem(""), false);
  });
});
