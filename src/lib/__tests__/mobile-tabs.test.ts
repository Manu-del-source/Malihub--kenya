import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { activeMobileTab, buildMobileTabs } from "../mobile-tabs";

describe("buildMobileTabs", () => {
  it("always exposes the five buyer tabs, with no seller workspace tabs", () => {
    const tabs = buildMobileTabs();
    assert.deepEqual(tabs.map((tab) => tab.label), ["Home", "Categories", "Cart", "Messages", "Account"]);
    assert.equal(tabs.length, 5);
    assert.equal(tabs.some((tab) => tab.href.startsWith("/seller/")), false);
  });

  it("opens the buyer app home and keeps the Seller Centre out of the tab bar", () => {
    const tabs = buildMobileTabs();
    assert.equal(tabs.find((tab) => tab.key === "home")?.href, "/app");
    assert.equal(tabs.some((tab) => tab.href === "/seller-center"), false);
  });
});

describe("activeMobileTab", () => {
  const tabs = buildMobileTabs();

  it("uses the most specific match (Cart beats Account)", () => {
    assert.equal(activeMobileTab(tabs, "/buyer/cart"), "cart");
    assert.equal(activeMobileTab(tabs, "/buyer/orders/xyz"), "account");
    assert.equal(activeMobileTab(tabs, "/buyer/wishlist"), "account");
    assert.equal(activeMobileTab(tabs, "/admin/reports"), "account");
    assert.equal(activeMobileTab(tabs, "/"), null);
    assert.equal(activeMobileTab(tabs, "/app"), "home");
    assert.equal(activeMobileTab(tabs, "/app?sort=newest"), "home");
    assert.equal(activeMobileTab(tabs, "/marketplace"), "categories");
    assert.equal(activeMobileTab(tabs, "/messages"), "messages");
    assert.equal(activeMobileTab(tabs, "/seller/orders"), "account");
    assert.equal(activeMobileTab(tabs, "/seller-center"), "account");
  });

  it("does not match lookalike paths", () => {
    assert.equal(activeMobileTab(tabs, "/accounting"), null);
    assert.equal(activeMobileTab(tabs, "/buyer-guide"), null);
    assert.equal(activeMobileTab(tabs, "/sellers-guide"), null);
  });
});
