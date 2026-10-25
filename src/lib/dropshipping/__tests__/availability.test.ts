import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifySupplierAvailability, type AvailabilityInput } from "../availability";

const NOW = new Date("2026-10-25T12:00:00.000Z");
const fresh = (overrides: Partial<AvailabilityInput> = {}): AvailabilityInput => ({
  supplierStatus: "APPROVED",
  approvalStatus: "APPROVED",
  isActive: true,
  stockStatus: "IN_STOCK",
  availableQuantity: 20,
  stockVerifiedAt: new Date("2026-10-25T10:00:00.000Z"),
  lastSyncedAt: null,
  maxAgeHours: 48,
  now: NOW,
  ...overrides,
});

describe("supplier stock freshness", () => {
  it("never presents a snapshot as guaranteed or live", () => {
    const result = classifySupplierAvailability(fresh());
    assert.equal(result.level, "AVAILABLE");
    assert.equal(result.isSnapshot, true);
    assert.equal(result.isGuaranteed, false);
    assert.equal(result.requiresFulfilmentConfirmation, true);
    assert.equal(result.ageHours, 2);
  });

  it("hides products that are not approved, active or in stock", () => {
    const cases: Array<[Partial<AvailabilityInput>, string]> = [
      [{ supplierStatus: "PENDING" }, "supplier_not_approved"],
      [{ approvalStatus: "PENDING_REVIEW" }, "supplier_product_not_approved"],
      [{ isActive: false }, "supplier_product_not_approved"],
      [{ stockStatus: "OUT_OF_STOCK" }, "supplier_out_of_stock"],
      [{ availableQuantity: 0 }, "supplier_out_of_stock"],
      [{ stockStatus: "DISCONTINUED" }, "supplier_out_of_stock"],
    ];
    for (const [overrides, warning] of cases) {
      const result = classifySupplierAvailability(fresh(overrides));
      assert.equal(result.level, "UNAVAILABLE");
      assert.equal(result.canImport, false);
      assert.ok(result.warnings.includes(warning));
    }
  });

  it("marks stale and never-verified snapshots with explicit caveats", () => {
    const stale = classifySupplierAvailability(
      fresh({ stockVerifiedAt: new Date("2026-10-20T12:00:00.000Z") }),
    );
    assert.equal(stale.level, "STALE");
    assert.equal(stale.isStale, true);
    assert.equal(stale.canImport, true);
    assert.ok(stale.warnings.includes("stock_snapshot_stale"));

    const unknown = classifySupplierAvailability(fresh({ stockVerifiedAt: null, lastSyncedAt: null }));
    assert.equal(unknown.level, "UNKNOWN");
    assert.equal(unknown.verifiedAt, null);
    assert.equal(unknown.canImport, true);
    assert.ok(unknown.warnings.includes("stock_never_verified"));
  });

  it("uses lastSyncedAt as a legacy fallback but still labels it a snapshot", () => {
    const result = classifySupplierAvailability(
      fresh({ stockVerifiedAt: null, lastSyncedAt: new Date("2026-10-25T11:00:00.000Z") }),
    );
    assert.equal(result.level, "AVAILABLE");
    assert.equal(result.isSnapshot, true);
    assert.equal(result.ageHours, 1);
  });

  it("flags low stock as limited rather than guaranteed", () => {
    const limited = classifySupplierAvailability(fresh({ stockStatus: "LOW_STOCK" }));
    assert.equal(limited.level, "LIMITED");
    assert.equal(limited.canImport, true);
    assert.ok(limited.warnings.includes("limited_stock"));
  });
});
