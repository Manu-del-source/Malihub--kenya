import { before, after, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
mock.module("server-only", { namedExports: {} });
let estimate: typeof import("@/modules/orders/delivery-pricing").estimateCountyDelivery;
const saved = process.env.MALIHUB_DELIVERY_COUNTY_RATES_JSON;
before(async () => { ({ estimateCountyDelivery: estimate } = await import("@/modules/orders/delivery-pricing")); });
after(() => { if (saved === undefined) delete process.env.MALIHUB_DELIVERY_COUNTY_RATES_JSON; else process.env.MALIHUB_DELIVERY_COUNTY_RATES_JSON = saved; });

describe("configured county estimates", () => {
  it("returns the configured minor-unit KES rate per seller and canonical county", () => {
    process.env.MALIHUB_DELIVERY_COUNTY_RATES_JSON = '{"Nairobi":25000,"Kiambu":0}';
    assert.deepEqual(estimate(" naIROBi "), { county: "Nairobi", feeCents: 25000, currency: "KES", source: "COUNTY_RATE", basis: "PER_SELLER_ORDER", requiresConfirmation: true });
    assert.equal(estimate("Kiambu").feeCents, 0);
  });
  it("fails closed for missing rates and invalid counties", () => {
    process.env.MALIHUB_DELIVERY_COUNTY_RATES_JSON = '{"Nairobi":25000}';
    assert.throws(() => estimate("Kiambu"), /not yet priced/i);
    assert.throws(() => estimate("Imaginary County"), /valid Kenyan/i);
    delete process.env.MALIHUB_DELIVERY_COUNTY_RATES_JSON;
    assert.throws(() => estimate("Nairobi"), /not configured/i);
  });
  it("rejects malformed, negative, non-integer, overflow and unknown-key configuration", () => {
    for (const raw of ['null', '[]', '{}', '{bad', '{"Nairobi":-1}', '{"Nairobi":1.5}', '{"Nairobi":"25000"}', '{"Nairobi":2147483648}', '{"Nairobi":25000,"Bad County":1}', '{"Nairobi":25000,"Kiambu":-1}']) {
      process.env.MALIHUB_DELIVERY_COUNTY_RATES_JSON = raw;
      assert.throws(() => estimate("Nairobi"), /configuration is invalid/i, raw);
    }
  });
});
