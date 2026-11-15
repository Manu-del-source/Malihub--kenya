import test from "node:test";
import assert from "node:assert/strict";
import { retrieveMaliHubKnowledge } from "./knowledge-base";

test("retrieves courier tracking guidance for buyer tracking questions", () => {
  const results = retrieveMaliHubKnowledge("Where can I find my courier tracking number?");
  assert.ok(results.some((item) => item.title === "Buyer order tracking"));
});

test("retrieves seller dispatch guidance", () => {
  const results = retrieveMaliHubKnowledge("How does a seller dispatch and ship an order?");
  assert.ok(results.some((item) => item.title === "Seller Centre and order fulfilment"));
});

test("retrieves payment safety guidance", () => {
  const results = retrieveMaliHubKnowledge("My M-Pesa payment receipt is pending");
  assert.ok(results.some((item) => item.title === "Payments and payment problems"));
});

test("returns no articles for unrelated or empty input", () => {
  assert.deepEqual(retrieveMaliHubKnowledge(""), []);
  assert.deepEqual(retrieveMaliHubKnowledge("xyzqv 998877"), []);
});

test("retrieves exact Seller Centre navigation for US and UK spelling", () => {
  for (const question of [
    "Where do I find the seller center?",
    "How do I open my seller dashboard?",
    "I already have an account, how do I access Seller Centre?",
  ]) {
    const results = retrieveMaliHubKnowledge(question);
    assert.ok(results.some((item) => item.title === "Seller Centre and order fulfilment"), question);
  }
});
