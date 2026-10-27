import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildCheckoutSummary, type CartLineLike } from "@/lib/payments/checkout-summary";

/**
 * The checkout summary the buyer reviews before paying.
 *
 * It is a projection of the server's cart only: every price, line total and
 * total below is computed from the values `getCart` returns, and the seller
 * grouping mirrors `checkoutCart`'s one-order-per-seller behaviour so the UI
 * can show the split before anything is created.
 */

function line(overrides: Partial<CartLineLike> & { sellerId?: string; sellerName?: string } = {}): CartLineLike {
  const { sellerId = "seller-1", sellerName = "Yegon Motors", ...rest } = overrides;
  return {
    id: "line-1",
    productId: "product-1",
    quantity: 2,
    unitPriceCents: 100_000,
    isAvailable: true,
    stockAvailable: 5,
    product: {
      title: "Toyota Probox",
      slug: "toyota-probox",
      images: [{ url: "https://res.cloudinary.com/example/probox.jpg" }],
      seller: { id: sellerId, businessName: sellerName },
    },
    ...rest,
  };
}

describe("buildCheckoutSummary", () => {
  it("totals the available lines from server prices", () => {
    const summary = buildCheckoutSummary([
      line({ id: "a", quantity: 2, unitPriceCents: 100_000 }),
      line({ id: "b", productId: "product-2", quantity: 1, unitPriceCents: 250_000 }),
    ]);

    assert.equal(summary.itemCount, 2);
    assert.equal(summary.unavailableCount, 0);
    assert.equal(summary.subtotalCents, 450_000);
    assert.equal(summary.totalCents, summary.subtotalCents, "this projection is before the county estimate is loaded");
    assert.equal(summary.amountsValid, true);
    assert.equal(summary.groups.length, 1);
    assert.equal(summary.groups[0]!.subtotalCents, 450_000);
    assert.equal(summary.groups[0]!.lines[0]!.lineTotalCents, 200_000);
    assert.equal(
      summary.groups[0]!.lines[0]!.imageUrl,
      "https://res.cloudinary.com/example/probox.jpg"
    );
  });

  it("splits a multi-seller cart into one group per seller", () => {
    const summary = buildCheckoutSummary([
      line({ id: "a", sellerId: "seller-1", sellerName: "Yegon Motors" }),
      line({ id: "b", sellerId: "seller-2", sellerName: "Grace Phones", unitPriceCents: 50_000, quantity: 1 }),
    ]);

    assert.equal(summary.sellerCount, 2, "checkout will create one order per seller");
    assert.equal(summary.groups.length, 2);
    assert.deepEqual(
      summary.groups.map((group) => group.sellerName),
      ["Yegon Motors", "Grace Phones"]
    );
    assert.equal(summary.groups[0]!.subtotalCents, 200_000);
    assert.equal(summary.groups[1]!.subtotalCents, 50_000);
    assert.equal(summary.totalCents, 250_000);
  });

  it("excludes unavailable lines from every total but still reports them", () => {
    const summary = buildCheckoutSummary([
      line({ id: "a", quantity: 2, unitPriceCents: 100_000 }),
      line({ id: "b", isAvailable: false, quantity: 3, unitPriceCents: 999_999 }),
    ]);

    assert.equal(summary.itemCount, 2);
    assert.equal(summary.unavailableCount, 1);
    assert.equal(summary.subtotalCents, 200_000);
    assert.equal(summary.groups[0]!.lines[1]!.lineTotalCents, 0);
  });

  it("blocks invalid line or per-seller totals but permits a safe combined total across sellers", () => {
    assert.equal(buildCheckoutSummary([line({ unitPriceCents: 2_147_483_647, quantity: 2 })]).amountsValid, false);
    assert.equal(buildCheckoutSummary([line({ unitPriceCents: -1, quantity: 1 })]).amountsValid, false);
    assert.equal(buildCheckoutSummary([line({ unitPriceCents: 1_000, quantity: 1.5 })]).amountsValid, false);
    assert.equal(buildCheckoutSummary([
      line({ id: "a", quantity: 1, unitPriceCents: 2_000_000_000 }),
      line({ id: "b", quantity: 1, unitPriceCents: 2_000_000_000 }),
    ]).amountsValid, false, "a single seller's subtotal must fit a PostgreSQL integer");
    const split = buildCheckoutSummary([
      line({ id: "a", sellerId: "seller-1", quantity: 1, unitPriceCents: 2_000_000_000 }),
      line({ id: "b", sellerId: "seller-2", quantity: 1, unitPriceCents: 2_000_000_000 }),
    ]);
    assert.equal(split.amountsValid, true);
    assert.equal(split.subtotalCents, 4_000_000_000, "separate seller orders can have a larger combined cart total");
  });

  it("is empty and free of groups when the cart is empty", () => {
    const summary = buildCheckoutSummary([]);
    assert.deepEqual(summary, {
      groups: [],
      sellerCount: 0,
      itemCount: 0,
      unavailableCount: 0,
      amountsValid: true,
      subtotalCents: 0,
      totalCents: 0,
    });
  });
});
