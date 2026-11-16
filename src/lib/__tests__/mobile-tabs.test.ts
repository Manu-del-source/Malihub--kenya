import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { activeMobileTab, buildMobileTabs, mobileMode } from "../mobile-tabs";

describe("mobileMode", () => {
  it("is seller mode only for sellers inside /seller", () => {
    assert.equal(mobileMode("/seller/orders", true), "seller");
    assert.equal(mobileMode("/seller", true), "seller");
    assert.equal(mobileMode("/seller/orders", false), "shop");
    assert.equal(mobileMode("/account", true), "shop");
    assert.equal(mobileMode("/seller-center", true), "shop");
    assert.equal(mobileMode("/sellers-guide", true), "shop");
  });
});

describe("buildMobileTabs", () => {
  it("is five tabs in both modes", () => {
    assert.equal(buildMobileTabs({ mode: "shop" }).length, 5);
    assert.equal(buildMobileTabs({ mode: "seller" }).length, 5);
  });
  it("shop mode: Home, Categories, Cart, Messages, Account — no role tabs", () => {
    assert.deepEqual(buildMobileTabs({ mode: "shop" }).map((t) => t.label), ["Home", "Categories", "Cart", "Messages", "Account"]);
  });
  it("seller mode puts Orders one tap away and keeps a More menu", () => {
    const tabs = buildMobileTabs({ mode: "seller" });
    assert.equal(tabs.find((t) => t.key === "seller-orders")?.href, "/seller/orders");
    assert.equal(tabs.find((t) => t.key === "seller-more")?.href, "/seller/menu");
  });
});

describe("activeMobileTab", () => {
  const shop = buildMobileTabs({ mode: "shop" });
  const seller = buildMobileTabs({ mode: "seller" });
  it("shop: most specific wins (Cart beats Account; orders/wishlist/admin are Account)", () => {
    assert.equal(activeMobileTab(shop, "/buyer/cart"), "cart");
    assert.equal(activeMobileTab(shop, "/buyer/orders/xyz"), "account");
    assert.equal(activeMobileTab(shop, "/buyer/wishlist"), "account");
    assert.equal(activeMobileTab(shop, "/admin/reports"), "account");
    assert.equal(activeMobileTab(shop, "/"), "home");
    assert.equal(activeMobileTab(shop, "/marketplace"), "categories");
    assert.equal(activeMobileTab(shop, "/messages"), "messages");
  });
  it("shop: no lookalike matches", () => {
    assert.equal(activeMobileTab(shop, "/accounting"), null);
    assert.equal(activeMobileTab(shop, "/buyer-guide"), null);
  });
  it("seller: Orders/Listings/Messages/More and Overview fallback", () => {
    assert.equal(activeMobileTab(seller, "/seller"), "seller-overview");
    assert.equal(activeMobileTab(seller, "/seller/orders/abc"), "seller-orders");
    assert.equal(activeMobileTab(seller, "/seller/listings/new"), "seller-listings");
    assert.equal(activeMobileTab(seller, "/seller/messages"), "seller-messages");
    assert.equal(activeMobileTab(seller, "/seller/products"), "seller-more");
    assert.equal(activeMobileTab(seller, "/seller/sales"), "seller-more");
  });
});
