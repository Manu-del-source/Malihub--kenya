import { afterEach, before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

const ORIGIN = "http://localhost:3000";
const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const FAKE_SECRET = "sk_test_syntheticsecret123456789";
const FAKE_PRIVATE = "synthetic-private-provider-metadata";
let session: { id: string; email: string } | null = null;
let orderError: Error | null = null;
let existing: { customerReference: string; metadata: unknown } | null = null;
let createData: Record<string, unknown> | null = null;
let providerBody: Record<string, unknown> | null = null;
let providerReject = false;
let providerBadUrl = false;
let providerAccessCode = "synthetic_access_code";
const originalFetch = globalThis.fetch;

const db = {
  order: {
    findFirst: async ({ where }: { where: { id: string; buyerId: string } }) => {
      if (orderError) throw orderError;
      return where.id === ORDER_ID && where.buyerId === "buyer-a"
        ? { id: ORDER_ID, orderNumber: "MH-ORDER", status: "PENDING", totalCents: 245000 }
        : null;
    },
  },
  payment: {
    findFirst: async () => existing,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      createData = data;
      return { id: "payment-a" };
    },
    updateMany: async () => ({ count: 1 }),
  },
};

mock.module("server-only", { namedExports: {} });
mock.module("@/lib/prisma", { namedExports: { prisma: db } });
mock.module("@/lib/auth", { namedExports: { getCurrentUser: async () => session ? { user: session } : null } });
mock.module("@/lib/rate-limit", {
  namedExports: {
    rateLimit: { paymentInitiate: async () => ({ success: true }) },
    formatRetryAfter: () => "later",
  },
});
let route: typeof import("@/app/api/payments/paystack/initialize/route");

before(async () => { route = await import("@/app/api/payments/paystack/initialize/route"); });
beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = ORIGIN;
  process.env.PAYSTACK_SECRET_KEY = FAKE_SECRET;
  process.env.PAYSTACK_CALLBACK_URL = "https://app.example.test/checkout/payment-result";
  session = { id: "buyer-a", email: "buyer@example.test" };
  orderError = null;
  existing = null;
  createData = null;
  providerBody = null;
  providerReject = false;
  providerBadUrl = false;
  providerAccessCode = "synthetic_access_code";
  globalThis.fetch = (async (_url, init) => {
    providerBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify(providerReject
      ? { status: false, message: FAKE_PRIVATE }
      : {
          status: true,
          data: {
            authorization_url: providerBadUrl ? "https://untrusted.example/checkout" : "https://checkout.paystack.com/session",
            access_code: providerAccessCode,
            reference: providerBody.reference,
            payer: FAKE_PRIVATE,
            secret: FAKE_SECRET,
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = originalFetch; });

function request(body: unknown, origin = ORIGIN) {
  return new NextRequest(`${ORIGIN}/api/payments/paystack/initialize`, {
    method: "POST", headers: { origin, host: "localhost:3000", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Paystack initialization boundary", () => {
  it("uses server amount and identity and returns only the checkout identifiers", async () => {
    const response = await route.POST(request({ orderId: ORDER_ID, amount: 1, email: "attacker@example.test" }));
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(createData?.amountCents, 245000);
    assert.equal(providerBody?.amount, "245000");
    assert.equal(providerBody?.email, "buyer@example.test");
    assert.deepEqual(Object.keys(payload.data).sort(), ["accessCode", "reference", "reused"]);
    assert.equal(payload.data.accessCode, "synthetic_access_code");
    assert.equal(payload.data.reused, false);
    assert.equal(JSON.stringify(payload).includes(FAKE_SECRET), false);
    assert.equal(JSON.stringify(payload).includes(FAKE_PRIVATE), false);
  });

  it("rejects unauthenticated, cross-origin and foreign-order attempts", async () => {
    session = null;
    assert.equal((await route.POST(request({ orderId: ORDER_ID }))).status, 401);
    session = { id: "buyer-b", email: "b@example.test" };
    assert.equal((await route.POST(request({ orderId: ORDER_ID }))).status, 404);
    assert.equal((await route.POST(request({ orderId: ORDER_ID }, "https://other.example"))).status, 403);
    assert.equal(createData, null);
    assert.equal(providerBody, null);
  });

  it("reuses only validated checkout identifiers, never stored metadata", async () => {
    existing = { customerReference: "MH-EXISTING", metadata: { paystack: { accessCode: "existing_code", secret: FAKE_SECRET }, payer: FAKE_PRIVATE } };
    const response = await route.POST(request({ orderId: ORDER_ID }));
    const payload = await response.json();
    assert.equal(payload.data.reused, true);
    assert.deepEqual(Object.keys(payload.data).sort(), ["accessCode", "reference", "reused"]);
    assert.equal(JSON.stringify(payload).includes(FAKE_SECRET), false);
    assert.equal(providerBody, null);
    existing = { customerReference: "MH-EXISTING", metadata: { paystack: { accessCode: { secret: FAKE_SECRET } } } };
    assert.equal((await route.POST(request({ orderId: ORDER_ID }))).status, 409);
    existing = { customerReference: "MH-EXISTING", metadata: { paystack: { accessCode: FAKE_SECRET } } };
    const credential = await route.POST(request({ orderId: ORDER_ID }));
    assert.equal(credential.status, 409);
    assert.equal(JSON.stringify(await credential.json()).includes(FAKE_SECRET), false);
  });

  it("returns generic provider and database errors and never logs their contents", async () => {
    providerReject = true;
    const rejected = await route.POST(request({ orderId: ORDER_ID }));
    assert.equal(rejected.status, 502);
    assert.equal(JSON.stringify(await rejected.json()).includes(FAKE_PRIVATE), false);
    providerReject = false;
    providerAccessCode = FAKE_SECRET;
    const credential = await route.POST(request({ orderId: ORDER_ID }));
    assert.equal(credential.status, 503);
    assert.equal(JSON.stringify(await credential.json()).includes(FAKE_SECRET), false);
    providerAccessCode = "synthetic_access_code";
    providerBadUrl = true;
    assert.equal((await route.POST(request({ orderId: ORDER_ID }))).status, 503);

    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { logged.push(args); };
    try {
      orderError = new Error(`database error ${FAKE_SECRET} ${FAKE_PRIVATE}`);
      const failed = await route.POST(request({ orderId: ORDER_ID }));
      assert.equal(failed.status, 500);
      const output = JSON.stringify({ body: await failed.json(), logged });
      assert.equal(output.includes(FAKE_SECRET), false);
      assert.equal(output.includes(FAKE_PRIVATE), false);
      assert.match(output, /unexpected/);
    } finally {
      console.error = original;
    }
  });
});
