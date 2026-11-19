import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { activeMobileTab, buildMobileTabs } from "../mobile-tabs";

describe("buildMobileTabs", () => {
  it("keeps the five primary mobile destinations without adding a duplicate seller tab", () => {
    const tabs = buildMobileTabs();
    assert.deepEqual(tabs.map((tab) => tab.label), ["Home", "Categories", "Cart", "Messages", "Account"]);
    assert.equal(tabs.length, 5);
    assert.equal(tabs.some((tab) => tab.href.startsWith("/seller/")), false);
  });

  it("keeps the app home and makes seller tools reachable through Account", () => {
    const tabs = buildMobileTabs();
    assert.equal(tabs.find((tab) => tab.key === "home")?.href, "/app");
    assert.equal(tabs.some((tab) => tab.href === "/seller-center"), false);\n    assert.equal(tabs.find((tab) => tab.key === "account")?.href, "/account");
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
    assert.equal(activeMobileTab(tabs, "/marketplace"), "categories");
    assert.equal(activeMobileTab(tabs, "/messages"), "messages");
    assert.equal(activeMobileTab(tabs, "/seller/orders"), "account");\n    assert.equal(activeMobileTab(tabs, "/seller/onboarding"), "account");
    assert.equal(activeMobileTab(tabs, "/seller-center"), "account");
  });

  it("does not match lookalike paths", () => {
    assert.equal(activeMobileTab(tabs, "/accounting"), null);
    assert.equal(activeMobileTab(tabs, "/buyer-guide"), null);
    assert.equal(activeMobileTab(tabs, "/sellers-guide"), null);
  });
});
