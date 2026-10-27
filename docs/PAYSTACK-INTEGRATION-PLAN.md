# Paystack integration plan — MaliHub Kenya

## Status — IMPLEMENTED (Phase 10)

Phases A, B and C of the rollout are done; Paystack is the active payment
provider and the retired PayHero integration has been removed from the
repository (see `docs/PAYMENTS-PAYHERO.md` for the retirement record).

What exists today:

| Layer | Where |
| --- | --- |
| Server-only Paystack client | `src/lib/payments/paystack.ts` — initialize, `GET /transaction/verify/{reference}`, config validation, timeouts, **HMAC-SHA512 webhook signature verification over the raw body** (constant-time) |
| Settlement primitives | `src/services/payment-service.ts` — conditional claims, `(provider, providerEventId)` dedup, exact amount/currency gates, ownership checks, terminal-state guards |
| Webhook ingestion | `POST /api/payments/paystack/webhook` (`src/services/payment-webhook-service.ts`) — signature gate → reference resolution → amount/currency gate → **server-to-server re-verification against Paystack** → conditional settlement. 401 + no write for anything unverifiable |
| Server-authoritative status | `GET/POST /api/payments/paystack/verify` (`src/services/payment-verify-service.ts`) — the buyer's screens ask the *server*, which asks *Paystack*; the browser's success claim has no power |
| Checkout initiation | `POST /api/payments/paystack/initialize` — auth + CSRF + rate limit, accepted delivery/version and authoritative totals checked under the order lock; a sole compatible checkout can be resumed. Multiple or terminal attempts require support review. |
| Buyer landing page | `/checkout/payment-result` — where `PAYSTACK_CALLBACK_URL` points; renders server-verified state, never a browser claim |
| Regression tests | `src/services/__tests__/payment-service.test.ts`, `payment-webhook-service.test.ts`, `payment-verify-service.test.ts`, `order-payment-lifecycle.test.ts` — forged callbacks, invalid/malformed signatures, wrong amount/currency, wrong ownership, duplicates, replays, ref mismatch, provider-verify failure, legitimate success |

Remaining work includes marketplace/payout compliance, production cutover,
and a documented reconciliation/release process for ambiguous or failed
hosted checkouts. Until revocation or expiry is established, attempts, quotes
and cancellations stay locked as described in `docs/DELIVERY-AND-PRODUCT-SIZES.md`.

## Required configuration

Set these variables in local development and the Vercel project environment.
Use the Paystack **Test Mode** secret key first; do not commit secrets.

- `PAYSTACK_SECRET_KEY`: server-only `sk_test_...` key for testing.
- `PAYSTACK_CALLBACK_URL`: absolute HTTPS URL for the buyer return page.
- `PAYSTACK_TIMEOUT_MS`: optional outbound timeout, defaults to 15000.

The webhook should be configured separately in Paystack Dashboard → Settings /
API Keys & Webhooks to point at the MaliHub webhook endpoint once that endpoint
is implemented and deployed.

## Payment flow (as implemented)

The numbered flow below is what the code above does; it is listed unchanged
from the plan so a reviewer can check each requirement against the
implementation.

1. Authenticate the buyer and confirm the order belongs to them and is payable.
2. Read the amount and buyer email from trusted database records; never accept
   amount, currency, buyer identity, or callback URL from the browser.
3. Persist a unique MaliHub payment attempt and reference before contacting
   Paystack. Keep the amount in KES minor units (integer cents in the database).
4. Initialize the Paystack transaction using KES subunits and the unique
   reference. Redirect the buyer to the returned Paystack checkout URL.
5. Handle `charge.success` at a public webhook route by validating
   `x-paystack-signature` against the exact raw request body with HMAC-SHA512.
6. Verify the reference server-to-server with Paystack. Confirm exact reference,
   expected KES amount, currency, successful status, and test/live environment
   before applying the existing conditional payment/order settlement primitives.
7. Make settlement idempotent. Webhook retries, return-page reloads, and status
   polling must never mark an order paid twice.
8. Keep ambiguous network timeouts reserved and verify the existing reference;
   never blindly create a second transaction when the first outcome is unknown.
   After a terminal attempt, manual support review is required; automated
   checkout revocation, release and reconciliation are not yet implemented.

## Marketplace / seller payout boundary

MaliHub intends to collect buyer payments and later pay independent sellers.
Collection and seller payouts are separate financial flows. Before enabling live
payments, obtain written approval from Paystack for this marketplace model and
confirm the available payout product, seller onboarding/KYC requirements,
fees, settlement timing, refunds, chargebacks, reserves, and reconciliation.
Do not represent an ordinary merchant collection account as an approved
payment-aggregation arrangement. Never pay sellers based only on the browser
return URL.

## Rollout sequence

- Phase A: client foundation and configuration — **done**.
- Phase B: provider-neutral database enum/migration, initiation route, callback
  route, status verification, checkout UI wiring, and unit tests — **done**
  (default flipped in
  `prisma/migrations/manual_phase10_paystack_provider_default.sql`).
- Phase C: test-mode end-to-end tests for success, failure, duplicates,
  amount mismatch, invalid signature, timeout, and concurrent attempts —
  **done** (service + lifecycle suites; run with `npm test`). Live test-mode
  execution against Paystack's own API is still to be performed on a machine
  with network access; the suites stub the provider client so they run
  anywhere.
- Phase D: seller ledger/payout workflow only after compliance approval; require
  reconciliation and manual review for payout exceptions — **pending** (see the
  marketplace boundary above).
- Phase E: production cutover with feature flag and a documented rollback path
  — **pending**. Set `PAYSTACK_SECRET_KEY` to a live key and the live webhook
  URL in the Paystack dashboard; the code path is identical in both modes.
