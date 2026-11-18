import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getUnitPriceCents, validateProductPriceTiers } from "./product-price-tiers";

describe("product quantity pricing", () => {
  const tiers = [
    { minQuantity: 2, unitPriceCents: 91_000 },
    { minQuantity: 10, unitPriceCents: 85_000 },
  ];

  it("applies the highest eligible tier at exact boundaries", () => {
    assert.equal(getUnitPriceCents(125_000, tiers, 1), 125_000);
    assert.equal(getUnitPriceCents(125_000, tiers, 2), 91_000);
    assert.equal(getUnitPriceCents(125_000, tiers, 9), 91_000);
    assert.equal(getUnitPriceCents(125_000, tiers, 10), 85_000);
  });

  it("normalizes tiers into ascending quantity order", () => {
    assert.deepEqual(validateProductPriceTiers(125_000, [...tiers].reverse()), tiers);
  });

  it("rejects a tier that is not cheaper than the preceding price", () => {
    assert.throws(
      () => validateProductPriceTiers(125_000, [{ minQuantity: 2, unitPriceCents: 125_000 }]),
      /must be cheaper/
    );
  });

  it("rejects duplicate thresholds and invalid quantities", () => {
    assert.throws(
      () => validateProductPriceTiers(125_000, [
        { minQuantity: 2, unitPriceCents: 110_000 },
        { minQuantity: 2, unitPriceCents: 100_000 },
      ]),
      /different minimum/
    );
    assert.throws(
      () => validateProductPriceTiers(125_000, [{ minQuantity: 1, unitPriceCents: 100_000 }]),
      /start at 2/
    );
  });

  it("rejects invalid prices and too many tiers", () => {
    assert.throws(
      () => validateProductPriceTiers(125_000, [{ minQuantity: 2, unitPriceCents: 99 }]),
      /at least KSh 1/
    );
    assert.throws(
      () => validateProductPriceTiers(125_000, Array.from({ length: 9 }, (_, index) => ({
        minQuantity: index + 2,
        unitPriceCents: 120_000 - (index + 1) * 1_000,
      }))),
      /no more than 8/
    );
  });
});
