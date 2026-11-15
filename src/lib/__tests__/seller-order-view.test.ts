import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SELLER_ORDER_TABS,
  countSellerOrdersByTab,
  filterSellerOrders,
  paymentStatusLabel,
  parseSellerOrderTab,
  sellerNextStep,
} from "../seller-order-view";

type S = "PENDING" | "CONFIRMED" | "PAID" | "SHIPPED" | "DELIVERED" | "COMPLETED" | "CANCELLED" | "REFUNDED";
const mk = (status: S) => ({ status });
const ALL: S[] = ["PENDING", "CONFIRMED", "PAID", "SHIPPED", "DELIVERED", "COMPLETED", "CANCELLED", "REFUNDED"];

describe("seller order tabs", () => {
  it("places every status in exactly one non-'all' tab", () => {
    for (const status of ALL) {
      const hits = SELLER_ORDER_TABS.filter(
        (t) => t.key !== "all" && filterSellerOrders([mk(status)], t.key).length === 1
      );
      assert.equal(hits.length, 1, `${status} must appear in exactly one tab`);
    }
  });

  it("'ready to dispatch' contains only PAID orders, never unpaid ones", () => {
    const orders = ALL.map(mk);
    assert.deepEqual(filterSellerOrders(orders, "ready-to-dispatch"), [mk("PAID")]);
    assert.ok(!filterSellerOrders(orders, "ready-to-dispatch").some((o) => o.status === "PENDING"));
  });

  it("groups cancelled and refunded together, and counts add up", () => {
    const orders = ALL.map(mk);
    assert.equal(filterSellerOrders(orders, "cancelled-refunded").length, 2);
    const counts = countSellerOrdersByTab(orders);
    const sum = SELLER_ORDER_TABS.filter((t) => t.key !== "all").reduce((n, t) => n + counts[t.key], 0);
    assert.equal(counts.all, ALL.length);
    assert.equal(sum, ALL.length);
  });

  it("falls back to 'all' for unknown or forged tab values", () => {
    assert.equal(parseSellerOrderTab("nonsense"), "all");
    assert.equal(parseSellerOrderTab(undefined), "all");
    assert.equal(parseSellerOrderTab(["shipped", "x"]), "shipped");
  });

  it("tells the seller not to dispatch unpaid orders", () => {
    assert.match(sellerNextStep("PENDING"), /Do not dispatch/);
    assert.match(sellerNextStep("PAID"), /confirm it shipped/);
  });

  it("labels payment states and tolerates a missing payment", () => {
    assert.equal(paymentStatusLabel("SUCCESS"), "Payment confirmed");
    assert.equal(paymentStatusLabel(null), "No payment yet");
  });
});
