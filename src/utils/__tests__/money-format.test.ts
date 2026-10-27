import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatKes } from "@/utils";
import { addMoneyCents, isMoneyCents, MAX_MONEY_CENTS } from "@/lib/money";

describe("KES money presentation and bounds", () => {
  it("shows exact cents rather than rounding a buyer's fee or receipt", () => {
    assert.match(formatKes(25000), /250(?:\.00)?$/);
    assert.match(formatKes(25001), /250\.01$/);
    assert.match(formatKes(25050), /250\.50$/);
    assert.match(formatKes(99), /0\.99$/);
    assert.match(formatKes(-99), /^-.*0\.99$/);
    assert.match(formatKes(Number.MAX_SAFE_INTEGER), /90,071,992,547,409\.91$/);
    assert.equal(formatKes(Number.MAX_SAFE_INTEGER + 1), "—");
    assert.equal(formatKes(1.5), "—");
  });
  it("rejects negative, fractional, unsafe or overflowing totals", () => {
    for (const value of [-1, 1.5, NaN, Infinity, MAX_MONEY_CENTS + 1, "1"]) assert.equal(isMoneyCents(value), false);
    assert.equal(addMoneyCents(MAX_MONEY_CENTS, 1), null);
    assert.equal(addMoneyCents(200000, 25001), 225001);
  });
});
