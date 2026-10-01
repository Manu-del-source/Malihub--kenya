# Buyer checkout & M-Pesa payment frontend — Phase 18 report

Branch: `arena/01a0f841-malihub-kenya` · base commit `b30699f` · date 2026-10-01

The buyer payment layer is implemented on top of the **existing** PayHero
backend. No backend contract was redesigned, no provider was added, no schema
was changed, and no payment API was invented where one already existed. The
only new server route is a read/verify doorway the browser needed to observe an
order it owns (see §3).

---

## 1. Files

### New

| File | Lines | Responsibility |
| --- | --- | --- |
| `src/app/(dashboard)/checkout/page.tsx` | 93 | Server page: `requireUser()` + `getCart(prisma, user.id)` + `buildCheckoutSummary`; renders the checkout screen or the empty-cart state. **Creates nothing.** |
| `src/app/(dashboard)/checkout/loading.tsx` | 5 | `PageSkeleton` route loading state (server-safe, no handlers). |
| `src/components/shell/buyer/checkout-view.tsx` | 415 | Checkout screen: review → create orders → pay; payment-method section; deterministic CTA; multi-seller sequencing; success/failure panels. |
| `src/components/shell/buyer/mpesa-pay-section.tsx` | 291 | One order's M-Pesa block: phone field, action button, queued/waiting/paid/failed/timed-out/attempt-limit states, receipt summary, PIN-safety note. Shared by checkout and the buyer order page (retry). |
| `src/hooks/use-mpesa-payment.ts` | 294 | One order's payment lifecycle: validate → initiate STK → bounded polling → manual `checkNow` → retry on the same order; never invents success. |
| `src/lib/payments/checkout-client.ts` | 370 | The browser's only network surface. Endpoints, single-flight order creation, STK initiation, status fetch, error mapping, phone rule, pure payment-phase rule. |
| `src/lib/payments/checkout-summary.ts` | 107 | Pure projection of the server cart: line totals, per-seller groups, subtotal/total, unavailable lines. |
| `src/lib/payments/payment-snapshot.ts` | 105 | The buyer-safe snapshot types shared by server and client (no phone, no provider blob). |
| `src/services/payment-status-service.ts` | 199 | Server-side, ownership-scoped (`{ id, buyerId }`) snapshot read + verify wrapper around the existing `verifyPayheroPaymentStatus`. |
| `src/app/api/payments/payhero/status/route.ts` | 128 | `GET` (pure read) / `POST` (verify + read) for one of the caller's own orders. |
| `src/app/api/payments/payhero/__tests__/status-route.test.ts` | — | 10 tests: auth, CSRF, validation, ownership 404s, verification settlement, provider outage, no-reference short-circuit, 429. |
| `src/lib/payments/__tests__/checkout-client.test.ts` | — | 16 tests: method list, phone rule, error mapping, request shapes, state honesty, single-flight, multi-seller order. |
| `src/lib/payments/__tests__/checkout-summary.test.ts` | — | 4 tests: totals, per-seller split, unavailable exclusion, empty cart. |
| `src/components/shell/buyer/__tests__/checkout-ui-contract.test.ts` | — | 9 tests: routing/creation invariants, required copy, no `PAYHERO_*`/`process.env` in client code. |

### Modified

| File | Change |
| --- | --- |
| `src/components/shell/buyer/cart-view.tsx` | "Proceed to checkout" now **navigates to `/checkout`** (`Button asChild` + `Link`); the POST-and-redirect logic is gone. CTA disabled when the cart has unavailable lines or nothing to pay. |
| `src/app/(dashboard)/buyer/orders/[id]/page.tsx` | PENDING orders render `MpesaPaySection` (retry on the same order, `refreshOnSuccess`); paid orders show payment details (reference, receipt, `timeAgo(paidAt)`, attempts); "Payment required / nothing has been charged" copy retained; `CancelOrderButton` preserved. |
| `src/lib/auth/config.ts` | `/checkout` added to `PROTECTED_PREFIXES` (middleware gate). |
| `src/lib/rate-limit.ts` | `rateLimit.paymentStatusCheck` — 30 checks / 60 s per buyer for the verify path. |
| `src/lib/validations/payment.ts` | `paymentStatusRequestSchema` (`{ orderId: uuid }`) for the status route. |
| `src/services/cart-service.ts` | `CART_INCLUDE` selects the seller's `id` (needed to group the summary per seller). No pricing/stock logic touched. |
| `src/__tests__/canonical-routes.test.ts` | Asserts `/checkout` is protected. |
| `docs/PAYMENTS-PAYHERO.md` | New "Buyer checkout UI" section documenting the frontend layer and its state semantics. |

---

## 2. Routes and components created

**Page**

- `/checkout` — dynamic, session-required (middleware **and** `requireUser()`), empty-cart state, review/pay stages.

**API**

- `GET  /api/payments/payhero/status?orderId=<uuid>` — pure DB read, no provider call: `{order, payment|null, attempts{used,max,remaining}, payable, awaitingConfirmation, canInitiate, verification:null}`.
- `POST /api/payments/payhero/status` `{orderId}` — same-origin guarded, rate-limited; runs the existing `verifyPayheroPaymentStatus` for a waiting attempt, then returns the refreshed snapshot plus `verification:{attempted, ok, outcome?|code?}`.
- Errors: 400 invalid id/body, 401 unauthenticated, 404 for foreign **or** missing order (identical — no existence oracle), 429 `{code:"rate_limited"}` + `Retry-After`, 500 generic.

**Components**: `checkout-view`, `mpesa-pay-section` (shared with `/buyer/orders/[id]`), `checkout/page`, `checkout/loading`.

---

## 3. Reused backend APIs (unchanged)

| Existing API | Used for |
| --- | --- |
| `POST /api/orders` (`{}` body) | Creates one PENDING order per seller via `checkoutCart`. |
| `POST /api/payments/payhero/stk` `{orderId, phoneNumber}` | Starts/joins the PayHero STK push (`QUEUED` on success — never "paid"). |
| `verifyPayheroPaymentStatus` (existing service) | Reconciliation behind the new status route's POST — the same claims the callback uses. |
| `callback/route.ts` | Server-to-server settlement — untouched. |
| `getCart`, `checkoutCart`, `getBuyerOrder`, `cancelOrder` | Cart read, order creation, order/ownership reads, cancel-retry path. |
| Session/CSRF/rate-limit/order+payment state machines | All preserved; `/checkout` added to the existing protected-prefix list only. |

No Prisma schema change. No new environment variable. No provider or channel
selection from the client.

## 4. Flow trace

```
product page → add to cart → /buyer/cart (server cart)
   → "Proceed to checkout"           ← navigate only; nothing created/reserved
   → /checkout                        (middleware + requireUser; cart read server-side)
   → review summary                   (server prices, per-seller groups, stock blocks)
   → "Pay <total> with M-Pesa"        ← the ONLY trigger that creates an order
        → POST /api/orders {}         (single-flight; one PENDING order per seller)
   → phone pre-filled from account, editable (same Kenyan regex as the server)
   → POST /api/payments/payhero/stk {orderId, phoneNumber}
        → 200 = QUEUED → "STK Push sent — check your phone"
   → bounded polling: GET  …/status?orderId=…  every 6 s for 2 min
        + POST …/status (verify) on user request / after the window
   → server says SUCCESS / order PAID → success UI (receipt, order link)
   → FAILED/CANCELLED → retry button → STK again on the SAME order
   → unpaid order page → "Payment required" + Pay with M-Pesa (same order)
```

Multi-seller carts create N orders and are collected **one prompt at a time**
(N separate amounts), each resumable from its order page — never one prompt
charged across several orders.

## 5. Frontend payment boundary

- Browser sends only: `{}` to `/api/orders`, `{orderId, phoneNumber}` to the STK route, `{orderId}` / `?orderId=` to the status route.
- Never sent: prices, subtotal, total, amount, currency, `sellerId`, `buyerId`, `channelId`, `callbackUrl`, `paymentStatus`, provider settings.
- `PAYHERO_AUTH_TOKEN`, `PAYHERO_CHANNEL_ID`, `PAYHERO_CALLBACK_URL`, `PAYHERO_API_URL` and `process.env` never appear in the client/payment surface (enforced by test).
- The status route resolves ownership with `{ id, buyerId: sessionUserId }`; a foreign id is a 404 identical to a nonexistent one.
- Only the phone number and the order id cross the payment boundary.

## 6. UI states (12)

| # | State | Where |
| --- | --- | --- |
| 1 | Empty cart | `/checkout` server state |
| 2 | Review / ready to pay | checkout review stage |
| 3 | blocked — unavailable item | checkout review, CTA disabled + reason |
| 4 | Creating orders | checkout `creating` stage |
| 5 | Order creation failed | checkout error panel + retry |
| 6 | Ready to pay (M-Pesa selected, phone editable) | `mpesa-pay-section` idle |
| 7 | Initiating (request in flight) | section button "Sending M-Pesa request…" |
| 8 | Awaiting confirmation (QUEUED/PROCESSING — never success) | section "STK Push sent" + spinner |
| 9 | Paid (receipt, reference, order status) | section success panel |
| 10 | Payment failed | section failure panel + "Try M-Pesa again" |
| 11 | Timed out / no confirmation yet | warning panel + "Check status" |
| 12 | Attempt limit reached / order no longer payable | disabled CTA + "cannot start another attempt"; plus the order page's **Payment required** state and terminal order statuses |

Polling is bounded (6 s × 20 = 2 min) and stops on any terminal state; the
manual "Check status" button always exists after a timeout. All copy avoids
claiming success before the server confirms.

## 7. Tests

39 new tests in 4 new files (suite total 613 → 652 pass, 0 fail):

- `status-route.test.ts` (10): unauthenticated read touches nothing; read-only GET needs no Origin; missing/non-UUID id → 400; POST rejects cross-origin and non-JSON; foreign and nonexistent orders both 404; a PROCESSING attempt is verified and settles; provider outage is reported honestly and changes nothing; no provider reference → no round-trip; 429 with stable code.
- `checkout-client.test.ts` (16): only M-Pesa advertised; phone formats accepted/rejected; error mapping is safe and never leaks internals; `/api/orders` is called with `{}` and reads the per-seller array; STK body is exactly `{orderId, phoneNumber}`; `provider_not_configured` copy; status GET vs POST shapes; **QUEUED/PROCESSING maps to "awaiting", never "succeeded"**; concurrent clicks coalesce into one order-creation call; multi-seller sequencing.
- `checkout-summary.test.ts` (4): server-price totals, per-seller split, unavailable lines excluded, empty cart.
- `checkout-ui-contract.test.ts` (9): cart only navigates (no `/api/orders`, no order creation); checkout page requires a session and reads the DB cart; `/checkout` is middleware-protected; the order page retries the existing order; required copy present; no PayHero config or `process.env` in any client file; the browser sends only accepted fields.

## 8. Verification results

| Command | Result |
| --- | --- |
| `npm test` | **652 pass / 0 fail / 151 suites** (baseline before this work: 613 / 0 / 136) — includes all 136 pre-existing suites. |
| `npx tsc --noEmit` | clean, no errors. |
| `npm run lint` | clean, 0 warnings. |
| `npx next build` | succeeded; `/checkout` built as a dynamic route (3.78 kB / 144 kB first load); middleware 75 kB. |
| Dev smoke (`next dev`, unauthenticated curl) | `/checkout` → `307` to `/login?redirectTo=%2Fcheckout`; `GET /api/payments/payhero/status` → `401 {"success":false,"error":"Sign in required."}`. |

Environment note: `npx prisma generate` cannot run in this sandbox because
`binaries.prisma.sh` is unreachable (no network route); the build above used
the already-generated client. On a machine with network access the unchanged
`npm run build` script (`prisma generate && next build`) is the full command.

## 9. Limitations and follow-ups

1. **No DOM test library** in the repo (`@testing-library/react` absent), so
   the UI is covered by source-level contract tests plus pure-logic tests
   (summary, client, phase rule) rather than rendered-DOM tests.
2. **Polling is client-timed** (bounded, cancellable). A cron reconciler over
   stale `PROCESSING` payments remains the production-grade backstop; the
   verify endpoint already reuses the same claims that a reconciler would.
3. **Delivery address** is not collected in checkout — the existing order model
   arranges delivery with the seller, unchanged.
4. **Multi-seller checkout collects sequentially** (one prompt at a time); a
   buyer who abandons midway pays the remaining orders from their order pages.
5. The status route's verify path is per-buyer rate-limited (30/60 s); a
   determined buyer polling many orders will be throttled, which is intended.
