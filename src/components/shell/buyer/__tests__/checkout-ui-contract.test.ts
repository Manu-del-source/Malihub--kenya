import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { PROTECTED_PREFIXES, isProtectedPath } from "@/lib/auth/config";

/**
 * Structural invariants of the checkout UI.
 *
 * These are deliberately source-level assertions, in the same spirit as
 * `src/__tests__/canonical-routes.test.ts`: the guarantees below are about
 * how the screens are wired (a button that navigates instead of creating an
 * order; a retry that reuses the existing order; client files that never see
 * provider configuration). A rendered-DOM test cannot be run in this
 * repository's node:test harness, and a source scan catches the regressions
 * that matter here — reintroducing the old "checkout creates the order
 * immediately" behaviour, or a secret name creeping into a client component.
 */

const ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf-8");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    // Test files are not shipped to the browser; skip them so this scan only
    // ever judges product code (and never trips over its own needles).
    if (entry === "__tests__") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const CART_VIEW = "src/components/shell/buyer/cart-view.tsx";
const CHECKOUT_PAGE = "src/app/(dashboard)/checkout/page.tsx";
const ORDER_PAGE = "src/app/(dashboard)/buyer/orders/[id]/page.tsx";
const PAY_SECTION = "src/components/shell/buyer/mpesa-pay-section.tsx";
const CHECKOUT_VIEW = "src/components/shell/buyer/checkout-view.tsx";

const CLIENT_ROOTS = [
  path.join(ROOT, "src/components"),
  path.join(ROOT, "src/hooks"),
  path.join(ROOT, "src/lib/payments/checkout-client.ts"),
];

describe("checkout UI — routing and order creation", () => {
  it("'Proceed to checkout' navigates to /checkout and creates nothing", () => {
    const source = read(CART_VIEW);
    assert.match(source, /CHECKOUT_PATH/, "cart must link to the checkout constant");
    assert.match(source, /href=\{CHECKOUT_PATH\}/);
    assert.equal(
      source.includes("/api/orders"),
      false,
      "the cart must not create the order — checkout does that explicitly"
    );
  });

  it("the checkout page is authenticated and reads the cart on the server", () => {
    const source = read(CHECKOUT_PAGE);
    assert.match(source, /requireUser\(\)/, "the page must require a session");
    assert.match(source, /getCart\(prisma, user\.id\)/, "the cart must come from the database");
    assert.match(source, /buildCheckoutSummary/, "prices shown must be derived from server data");
    assert.match(source, /export const dynamic = "force-dynamic"/);
    assert.equal(source.includes("createCheckoutOrders"), false, "the page itself creates nothing");
    assert.equal(source.includes("fetch("), false, "the page never issues API calls itself");
  });

  it("/checkout is middleware-protected alongside the buyer area", () => {
    assert.ok((PROTECTED_PREFIXES as readonly string[]).includes("/checkout"));
    assert.ok(isProtectedPath("/checkout"));
  });

  it("the order page retries against the existing order, never a new one", () => {
    const source = read(ORDER_PAGE);
    assert.match(source, /MpesaPaySection/, "a PENDING order must offer the pay/retry UI");
    assert.match(source, /initialSnapshot=\{paymentSnapshot\}/, "retry starts from the real state");
    assert.equal(
      source.includes("createCheckoutOrders"),
      false,
      "retry must not create a second order"
    );
  });
});

describe("checkout UI — payment states and copy", () => {
  it("never presents a queued STK push as success", () => {
    const source = read(PAY_SECTION);
    assert.match(source, /STK Push sent/, "the queued state is named explicitly");
    assert.match(source, /Check your phone and enter your M-Pesa PIN/);
    assert.match(source, /Payment successful/, "success copy exists for the confirmed state");
    assert.match(source, /Payment was not completed/, "failure copy exists for the failed state");
    assert.match(source, /Your M-Pesa PIN is entered only on the official M-Pesa prompt/);
  });

  it("gates the checkout CTA on server data and blocks an unavailable cart", () => {
    const source = read(CHECKOUT_VIEW);
    assert.match(source, /Pay \{formatKes\(summary\.totalCents\)\} with M-Pesa/);
    assert.match(source, /blockedByStock/, "unavailable items must block payment");
    assert.match(source, /PAYMENT_METHODS\.map/, "payment methods render from the extensible list");
    assert.match(source, /createSerializedTask\(createCheckoutOrders\)/, "creation is single-flighted");
  });
});

describe("checkout UI — credentials never reach the browser", () => {
  it("no client file references PayHero configuration or process.env", () => {
    const forbidden = [
      "PAYHERO_AUTH_TOKEN",
      "PAYHERO_CHANNEL_ID",
      "PAYHERO_CALLBACK_URL",
      "PAYHERO_API_URL",
      "NEXT_PUBLIC_PAYHERO",
    ];

    for (const root of CLIENT_ROOTS) {
      const files = statSync(root).isDirectory() ? walk(root) : [root];
      for (const file of files) {
        const source = readFileSync(file, "utf-8");
        const relative = path.relative(ROOT, file);
        for (const needle of forbidden) {
          assert.equal(
            source.includes(needle),
            false,
            `${relative} must not reference ${needle}`
          );
        }
      }
    }
  });

  it("the checkout/payment client surface never reads process.env", () => {
    for (const relative of [
      CHECKOUT_VIEW,
      PAY_SECTION,
      "src/hooks/use-mpesa-payment.ts",
      "src/lib/payments/checkout-client.ts",
      "src/lib/payments/checkout-summary.ts",
      "src/lib/payments/payment-snapshot.ts",
    ]) {
      assert.equal(
        read(relative).includes("process.env"),
        false,
        `${relative} must not read process.env`
      );
    }
  });

  it("the browser sends only the fields the routes accept", () => {
    const source = read("src/lib/payments/checkout-client.ts");
    assert.match(source, /JSON\.stringify\(\{ orderId, phoneNumber \}\)/);
    assert.match(source, /body: JSON\.stringify\(\{\}\)/, "order creation sends an empty body");
    assert.equal(
      source.includes("amountCents:") && source.includes("body: JSON.stringify({ amountCents"),
      false,
      "no amount is ever sent from the client"
    );
  });
});
