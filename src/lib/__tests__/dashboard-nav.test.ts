import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDashboardNav } from "../dashboard-nav";

const labels = (items: { label: string }[]) => items.map((i) => i.label);

describe("buildDashboardNav", () => {
  it("shows a seller Orders entry even before the seller is verified", () => {
    const { primary } = buildDashboardNav({ hasSellerProfile: true, isAdmin: false, sellerVerified: false });
    const orders = primary.find((i) => i.label === "Orders");
    assert.ok(orders, "Orders must be discoverable for every seller");
    assert.equal(orders.href, "/seller/orders");
    assert.ok(!labels(primary).includes("Products"), "listing management stays verification-gated");
  });

  it("shows the full seller set for a verified seller", () => {
    const { primary } = buildDashboardNav({ hasSellerProfile: true, isAdmin: false, sellerVerified: true });
    for (const label of ["Dashboard", "Orders", "Products", "Sales", "Supplier orders", "My orders"]) {
      assert.ok(labels(primary).includes(label), `missing ${label}`);
    }
  });

  it("gives buyers only their own orders entry", () => {
    const { primary, account } = buildDashboardNav({ hasSellerProfile: false, isAdmin: false, sellerVerified: false });
    assert.deepEqual(primary.filter((i) => /orders/i.test(i.label)).map((i) => i.href), ["/buyer/orders"]);
    assert.ok(!labels(account).includes("Admin"));
  });

  it("adds the Admin entry for administrators", () => {
    const { account } = buildDashboardNav({ hasSellerProfile: false, isAdmin: true, sellerVerified: false });
    assert.ok(labels(account).includes("Admin"));
  });
});
