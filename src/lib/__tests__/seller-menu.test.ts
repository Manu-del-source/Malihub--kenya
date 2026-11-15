import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSellerMenu } from "../seller-menu";

describe("buildSellerMenu", () => {
  const labels = (v: boolean) => buildSellerMenu({ isAdmin: false, sellerVerified: v }).map((i) => i.label);
  it("excludes what is already a bottom tab", () => {
    for (const l of ["Dashboard", "Orders"]) assert.ok(!labels(true).includes(l), l);
  });
  it("keeps verification gating identical to desktop nav", () => {
    assert.deepEqual(labels(false), ["Supplier catalog"]);
    for (const l of ["Products", "Supplier orders", "Sales"]) assert.ok(labels(true).includes(l), l);
  });
});
