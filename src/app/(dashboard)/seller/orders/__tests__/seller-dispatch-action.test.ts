import assert from "node:assert/strict";
import { beforeEach, describe, it, mock } from "node:test";

/**
 * Seller dispatch server action: the handover attestation, validation and
 * verified-seller gates are enforced server-side. The transition service is
 * mocked here (its own rules are covered in order-transition-service.test.ts).
 */

class OrderTransitionError extends Error {
  constructor(message: string, public code: string) {
    super(message);
  }
}

const calls: Array<{ step: string; params: Record<string, unknown> }> = [];
let sellerRow: { id: string; verificationStatus: string } | null = { id: "seller-1", verificationStatus: "VERIFIED" };
let serviceError: Error | null = null;

mock.module("server-only", { namedExports: {} });
mock.module("next/cache", { namedExports: { revalidatePath: () => undefined } });
mock.module("@/lib/auth", {
  namedExports: { requireSellerAccess: async () => ({ user: { id: "user-1" } }) },
});
mock.module("@/lib/prisma", {
  namedExports: { prisma: { seller: { findUnique: async () => sellerRow } } },
});
mock.module("@/services/order-transition-service", {
  namedExports: {
    OrderTransitionError,
    markOrderFulfilled: async (_db: unknown, step: string, params: Record<string, unknown>) => {
      calls.push({ step, params });
      if (serviceError) throw serviceError;
      return { order: { status: step } };
    },
  },
});

const ORDER_ID = "3f2b8c1e-4a9d-4d1c-9b6a-2f5c8e7a1b3d";
const goodShipment = { carrierName: "G4S", trackingNumber: "TRK-1", handedToCourier: true };

let actions: typeof import("../actions") | null = null;
async function updateSellerOrderFulfilment(input: Parameters<typeof import("../actions").updateSellerOrderFulfilment>[0]) {
  actions ??= await import("../actions");
  return actions.updateSellerOrderFulfilment(input);
}

describe("updateSellerOrderFulfilment (dispatch)", () => {
  beforeEach(() => {
    calls.length = 0;
    sellerRow = { id: "seller-1", verificationStatus: "VERIFIED" };
    serviceError = null;
  });

  it("dispatches with valid tracking and records the handover attestation", async () => {
    const result = await updateSellerOrderFulfilment({ orderId: ORDER_ID, step: "SHIPPED", shipment: goodShipment });
    assert.deepEqual(result, { success: true, status: "SHIPPED" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].params.dispatchConfirmed, true);
    assert.equal(calls[0].params.actorSellerId, "seller-1");
  });

  it("refuses to dispatch without the physical-handover confirmation", async () => {
    const result = await updateSellerOrderFulfilment({
      orderId: ORDER_ID,
      step: "SHIPPED",
      shipment: { ...goodShipment, handedToCourier: false },
    });
    assert.equal(result.success, false);
    assert.match(result.error ?? "", /handed to the courier/i);
    assert.equal(calls.length, 0);
  });

  it("rejects a forged payload that omits the attestation entirely", async () => {
    const forged = { carrierName: "G4S", trackingNumber: "TRK-1" } as unknown as typeof goodShipment;
    const result = await updateSellerOrderFulfilment({ orderId: ORDER_ID, step: "SHIPPED", shipment: forged });
    assert.equal(result.success, false);
    assert.equal(calls.length, 0);
  });

  it("rejects missing courier, missing tracking number and malformed order ids", async () => {
    for (const shipment of [
      { ...goodShipment, carrierName: "  " },
      { ...goodShipment, trackingNumber: "" },
      { ...goodShipment, trackingNumber: "x".repeat(101) },
    ]) {
      const r = await updateSellerOrderFulfilment({ orderId: ORDER_ID, step: "SHIPPED", shipment });
      assert.equal(r.success, false);
    }
    const bad = await updateSellerOrderFulfilment({ orderId: "not-a-uuid", step: "SHIPPED", shipment: goodShipment });
    assert.equal(bad.success, false);
    assert.equal(calls.length, 0);
  });

  it("does not let a seller drive COMPLETED, CANCELLED or REFUNDED through this action", async () => {
    for (const step of ["COMPLETED", "CANCELLED", "REFUNDED", "PAID"]) {
      const r = await updateSellerOrderFulfilment({ orderId: ORDER_ID, step: step as "SHIPPED" });
      assert.equal(r.success, false, `${step} must be refused`);
    }
    assert.equal(calls.length, 0);
  });

  it("refuses unverified sellers and users without a seller row", async () => {
    sellerRow = { id: "seller-1", verificationStatus: "PENDING" };
    assert.equal((await updateSellerOrderFulfilment({ orderId: ORDER_ID, step: "SHIPPED", shipment: goodShipment })).success, false);
    sellerRow = null;
    assert.equal((await updateSellerOrderFulfilment({ orderId: ORDER_ID, step: "SHIPPED", shipment: goodShipment })).success, false);
    assert.equal(calls.length, 0);
  });

  it("surfaces service refusals (unpaid, other seller's, already completed) as errors", async () => {
    serviceError = new OrderTransitionError("This order cannot move to that status.", "invalid_transition");
    const r = await updateSellerOrderFulfilment({ orderId: ORDER_ID, step: "SHIPPED", shipment: goodShipment });
    assert.deepEqual(r, { success: false, error: "This order cannot move to that status." });
  });

  it("allows delivery confirmation without a shipment payload", async () => {
    const r = await updateSellerOrderFulfilment({ orderId: ORDER_ID, step: "DELIVERED" });
    assert.deepEqual(r, { success: true, status: "DELIVERED" });
    assert.equal(calls[0].params.dispatchConfirmed, undefined);
  });
});
