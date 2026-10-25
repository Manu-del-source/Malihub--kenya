import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";

/**
 * API boundary tests for dropshipping operations: session, seller
 * verification, same-origin CSRF, admin-only return decisions, and safe error
 * mapping. The service layer is mocked here; its state rules are tested in
 * src/services/__tests__/dropshipping-operations.test.ts.
 */

type Actor = { id: string; email: string; role: string; isActive: boolean; isBanned: boolean };
let actor: Actor | null = null;
let sellerVerified = true;
const transitionCalls: Array<Record<string, unknown>> = [];
const returnDecisionCalls: Array<Record<string, unknown>> = [];

const ORIGIN = "https://malihub.test";

mock.module("server-only", { namedExports: {} });
mock.module("@/lib/prisma", { namedExports: { prisma: {} } });
mock.module("@/lib/auth", {
  namedExports: {
    isAdministratorRole: (role: string) => role === "ADMIN" || role === "SUPER_ADMIN",
    getCurrentUser: async () => null,
  },
});
mock.module("@/lib/dropshipping/http", {
  namedExports: {
    requireActiveActor: async () =>
      actor
        ? { ok: true, actor }
        : { ok: false, response: NextResponse.json({ success: false, error: "Sign in required." }, { status: 401 }) },
    requireVerifiedSeller: async () =>
      sellerVerified
        ? { id: "seller-1", verificationStatus: "VERIFIED" }
        : NextResponse.json({ success: false, error: "Seller verification is required." }, { status: 403 }),
    requireAdminActor: async () =>
      actor && (actor.role === "ADMIN" || actor.role === "SUPER_ADMIN")
        ? { ok: true, actor }
        : {
            ok: false,
            response: NextResponse.json(
              { success: false, error: actor ? "Administrator access is required." : "Sign in required." },
              { status: actor ? 403 : 401 },
            ),
          },
    logSafeError: () => undefined,
    isPrismaErrorCode: () => false,
  },
});
mock.module("@/lib/dropshipping/route-errors", {
  namedExports: {
    dropshippingErrorResponse: (error: unknown) => {
      const e = error as { message?: string; code?: string; status?: number };
      return NextResponse.json(
        { success: false, error: e.message ?? "Unexpected error", code: e.code ?? "unexpected" },
        { status: e.status ?? 500 },
      );
    },
  },
});
mock.module("@/services/dropshipping-fulfilment-service", {
  namedExports: {
    transitionSupplierFulfilment: async (_db: unknown, input: Record<string, unknown>) => {
      transitionCalls.push(input);
      if (input.action === "RETRY") {
        throw Object.assign(new Error("Invalid supplier fulfilment transition."), {
          code: "invalid_transition",
          status: 409,
        });
      }
      return {
        id: input.fulfilmentId,
        reference: "SF-TEST-01",
        from: "AWAITING_SUPPLIER_CONFIRMATION",
        to: "CONFIRMED",
        idempotent: false,
      };
    },
    afterSupplierFulfilmentTransition: async () => undefined,
  },
});
mock.module("@/services/dropshipping-return-service", {
  namedExports: {
    updateSupplierReturnStatus: async (_db: unknown, input: Record<string, unknown>) => {
      returnDecisionCalls.push(input);
      return {
        id: input.returnRequestId,
        from: "REQUESTED",
        to: input.status,
        refundId: null,
        payoutHoldActive: true,
      };
    },
    afterReturnDecision: async () => undefined,
  },
});

let transitionRoute: typeof import("@/app/api/supplier-fulfilments/[id]/transition/route");
let returnDecisionRoute: typeof import("@/app/api/admin/supplier-returns/[id]/route");

const VALID_ID = "11111111-1111-4111-8111-111111111111";
const VALID_RETURN_ID = "22222222-2222-4222-8222-222222222222";
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function req(method: string, path: string, body?: unknown, crossOrigin = false): NextRequest {
  return new NextRequest(`${ORIGIN}${path}`, {
    method,
    headers: {
      host: "malihub.test",
      origin: crossOrigin ? "https://evil.example" : ORIGIN,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const SELLER: Actor = {
  id: "33333333-3333-4333-8333-333333333333",
  email: "seller@malihub.test",
  role: "SELLER",
  isActive: true,
  isBanned: false,
};
const BUYER: Actor = {
  id: "44444444-4444-4444-8444-444444444444",
  email: "buyer@malihub.test",
  role: "BUYER",
  isActive: true,
  isBanned: false,
};
const ADMIN: Actor = {
  id: "55555555-5555-4555-8555-555555555555",
  email: "admin@malihub.test",
  role: "ADMIN",
  isActive: true,
  isBanned: false,
};

before(async () => {
  transitionRoute = await import("@/app/api/supplier-fulfilments/[id]/transition/route");
  returnDecisionRoute = await import("@/app/api/admin/supplier-returns/[id]/route");
});

beforeEach(() => {
  actor = null;
  sellerVerified = true;
  transitionCalls.length = 0;
  returnDecisionCalls.length = 0;
});

describe("POST /api/supplier-fulfilments/[id]/transition", () => {
  it("requires a session and a verified seller", async () => {
    const unauthenticated = await transitionRoute.POST(
      req("POST", `/api/supplier-fulfilments/${VALID_ID}/transition`, { action: "CONFIRM_AVAILABILITY", finalUnitCostMinor: 1000 }),
      params(VALID_ID),
    );
    assert.equal(unauthenticated.status, 401);

    actor = BUYER;
    sellerVerified = false;
    const buyer = await transitionRoute.POST(
      req("POST", `/api/supplier-fulfilments/${VALID_ID}/transition`, { action: "CONFIRM_AVAILABILITY", finalUnitCostMinor: 1000 }),
      params(VALID_ID),
    );
    assert.equal(buyer.status, 403);
    assert.equal(transitionCalls.length, 0);
  });

  it("rejects cross-origin requests before calling the service", async () => {
    actor = SELLER;
    const res = await transitionRoute.POST(
      req("POST", `/api/supplier-fulfilments/${VALID_ID}/transition`, { action: "CONFIRM_AVAILABILITY", finalUnitCostMinor: 1000 }, true),
      params(VALID_ID),
    );
    assert.equal(res.status, 403);
    assert.equal(transitionCalls.length, 0);
  });

  it("validates path ids and action payloads", async () => {
    actor = SELLER;
    const badId = await transitionRoute.POST(
      req("POST", "/api/supplier-fulfilments/not-a-uuid/transition", { action: "CONFIRM_AVAILABILITY" }),
      params("not-a-uuid"),
    );
    assert.equal(badId.status, 400);
    const badAction = await transitionRoute.POST(
      req("POST", `/api/supplier-fulfilments/${VALID_ID}/transition`, { action: "MARK_PAID" }),
      params(VALID_ID),
    );
    assert.equal(badAction.status, 400);
    assert.equal(transitionCalls.length, 0);
  });

  it("passes a verified seller and an admin through with the correct actor role", async () => {
    actor = SELLER;
    const seller = await transitionRoute.POST(
      req("POST", `/api/supplier-fulfilments/${VALID_ID}/transition`, { action: "CONFIRM_AVAILABILITY", finalUnitCostMinor: 150000 }),
      params(VALID_ID),
    );
    assert.equal(seller.status, 200);
    assert.equal((transitionCalls[0]!.actor as { role: string }).role, "SELLER");

    actor = ADMIN;
    const admin = await transitionRoute.POST(
      req("POST", `/api/supplier-fulfilments/${VALID_ID}/transition`, {
        action: "RECORD_DELIVERY",
        deliveryEvidenceNote: "Courier proof reviewed by admin.",
      }),
      params(VALID_ID),
    );
    assert.equal(admin.status, 200);
    assert.equal((transitionCalls[1]!.actor as { role: string }).role, "ADMIN");
  });

  it("maps domain transition failures to a safe 409 without leaking internals", async () => {
    actor = SELLER;
    const res = await transitionRoute.POST(
      req("POST", `/api/supplier-fulfilments/${VALID_ID}/transition`, { action: "RETRY", reason: "Test invalid transition" }),
      params(VALID_ID),
    );
    assert.equal(res.status, 409);
    const json = await res.json();
    assert.equal(json.code, "invalid_transition");
    assert.equal(json.error, "Invalid supplier fulfilment transition.");
  });
});

describe("PATCH /api/admin/supplier-returns/[id]", () => {
  it("is admin-only and same-origin protected", async () => {
    actor = SELLER;
    const seller = await returnDecisionRoute.PATCH(
      req("PATCH", `/api/admin/supplier-returns/${VALID_RETURN_ID}`, { status: "APPROVED" }),
      params(VALID_RETURN_ID),
    );
    assert.equal(seller.status, 403);

    actor = ADMIN;
    const csrf = await returnDecisionRoute.PATCH(
      req("PATCH", `/api/admin/supplier-returns/${VALID_RETURN_ID}`, { status: "APPROVED" }, true),
      params(VALID_RETURN_ID),
    );
    assert.equal(csrf.status, 403);
    assert.equal(returnDecisionCalls.length, 0);
  });

  it("lets an admin apply a decision", async () => {
    actor = ADMIN;
    const res = await returnDecisionRoute.PATCH(
      req("PATCH", `/api/admin/supplier-returns/${VALID_RETURN_ID}`, {
        status: "APPROVED",
        responsibility: "SUPPLIER",
        resolutionNote: "Reviewed evidence.",
      }),
      params(VALID_RETURN_ID),
    );
    assert.equal(res.status, 200);
    assert.equal(returnDecisionCalls.length, 1);
    assert.equal((returnDecisionCalls[0]!.actor as { role: string }).role, "ADMIN");
    const json = await res.json();
    assert.equal(json.data.message.includes("No refund or payout was released automatically"), true);
  });
});
