import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { activeMobileTab, buildMobileTabs } from "../mobile-tabs";

describe("buildMobileTabs", () => {
  it("is always exactly five tabs, whatever the user's roles", () => {
    assert.equal(buildMobileTabs({ hasSellerProfile: false }).length, 5);
    assert.equal(buildMobileTabs({ hasSellerProfile: true }).length, 5);
  });

  it("makes Orders role-aware and keeps Cart/Seller/Admin out of the bar", () => {
    const seller = buildMobileTabs({ hasSellerProfile: true });
    const buyer = buildMobileTabs({ hasSellerProfile: false });
    assert.equal(seller.find((t) => t.key === "orders")?.href, "/seller/orders");
    assert.equal(buyer.find((t) => t.key === "orders")?.href, "/buyer/orders");
    for (const label of ["Cart", "Seller", "Admin"]) {
      assert.ok(!seller.some((t) => t.label === label), `${label} must not be a tab`);
    }
  });
});

describe("activeMobileTab", () => {
  const tabs = buildMobileTabs({ hasSellerProfile: true });
  it("picks the most specific match", () => {
    assert.equal(activeMobileTab(tabs, "/seller/orders"), "orders");
    assert.equal(activeMobileTab(tabs, "/seller/orders/abc"), "orders");
    assert.equal(activeMobileTab(tabs, "/seller/products"), "account");
    assert.equal(activeMobileTab(tabs, "/buyer/orders/xyz"), "orders");
  });
  it("highlights Account for role areas and Home only on the exact root", () => {
    assert.equal(activeMobileTab(tabs, "/admin/reports"), "account");
    assert.equal(activeMobileTab(tabs, "/account/addresses"), "account");
    assert.equal(activeMobileTab(tabs, "/"), "home");
  });
  it("does not match lookalike prefixes and highlights nothing on the cart", () => {
    assert.equal(activeMobileTab(tabs, "/accounting"), null);
    assert.equal(activeMobileTab(tabs, "/buyer/cart"), null);
    assert.equal(activeMobileTab(tabs, "/marketplace"), "categories");
  });
});
