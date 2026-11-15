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
| Checkout initiation | `POST /api/payments/paystack/initialize` — auth + CSRF + per-buyer rate limit, attempt rules (max 5 per order, in-flight joins) |
| Buyer landing page | `/checkout/payment-result` — where `PAYSTACK_CALLBACK_URL` points; renders server-verified state, never a browser claim |
| Regression tests | `src/services/__tests__/payment-service.test.ts`, `payment-webhook-service.test.ts`, `payment-verify-service.test.ts`, `order-payment-lifecycle.test.ts` — forged callbacks, invalid/malformed signatures, wrong amount/currency, wrong ownership, duplicates, replays, ref mismatch, provider-verify failure, legitimate success |

Remaining (rollout phases D–E below) is the marketplace/payout compliance work
and the production cutover — not a code gap in the collection path.

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
8. Reconcile ambiguous network timeouts by verifying the existing reference;
   never blindly create a second transaction when the first outcome is unknown.

## Marketplace / seller payout boundary

MaliHub intends to collect buyer payments and later pay independent sellers. Collection settlement and seller payments are separate financial flows. **Initial operating mode: manual seller payouts by MaliHub administrators.** Do not expose a seller withdrawal request or automated seller-transfer flow until a later approved implementation.

### Confirmed published Kenya timing (verify against MaliHub's own Paystack account before launch)

- Paystack's Kenya pricing and terms publish **T+2 for local transaction settlement** to the merchant's configured payout account. This is Paystack-to-MaliHub settlement, not a seller withdrawal SLA. The schedule is expressed as up to two business days from the transaction date; Paystack may experience bank, provider, compliance or technical delays.
- Paystack's Transfers documentation says transfers are typically processed within seconds, but a transfer can remain pending, fail or be reversed. A successful provider status does not guarantee immediate credit by the recipient's bank or wallet.
- Paystack states Transfers are available to registered businesses. Access, recipient rails, fees, limits, and suitability for MaliHub's marketplace/seller-payee model must be confirmed with Paystack for this specific account.
- Seller eligibility is independent of T+2: it is governed by order completion, any transaction-specific inspection/dispute policy, open protection cases, refunds, and reconciliation. Never calculate a seller's availability date by adding two days to the buyer's payment date.
- During the manual phase, an administrator confirms order eligibility, verifies Paystack settlement/funds availability, and pays the seller manually using an approved business payment method. Record the amount, seller, order allocation, destination, payment date, payment reference/proof, operator and status in the internal reconciliation process. Do not mark a seller as paid merely because an order is completed.
- Sellers must be told that there is no self-service withdrawal facility and no guaranteed payout turnaround time during this interim phase. Communicate the expected date when each manual payout is arranged.
- Do not deduct or allocate provider collection or transfer fees to sellers unless the applicable fee responsibility is contractually confirmed and the exact charge is disclosed before the transaction/withdrawal.

Official references:
- https://paystack.com/ke/pricing
- https://paystack.com/ke/terms
- https://support.paystack.com/en/articles/2132866
- https://paystack.com/docs/transfers/how-transfers-work/

Before enabling live seller payouts, obtain written Paystack approval for this marketplace model and confirm the payout product, seller/payee onboarding and KYC requirements, fees, settlement timing, refunds, chargebacks, reserves, recipient limits and reconciliation. Do not represent an ordinary merchant collection account as an approved payment-aggregation arrangement. Never pay sellers based only on the browser return URL.

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
- Interim operations: manual seller payouts by an authorised MaliHub administrator after order eligibility and settled-funds reconciliation. No seller withdrawal UI or automatic transfer endpoint is enabled.
- Future Phase D: auditable seller ledger, admin payout recording/approval, seller withdrawal requests, provider transfer adapter, signed payout webhook/status reconciliation and exception handling — **pending** until Paystack gives written approval for MaliHub's marketplace model and confirms the enabled transfer product.
- Phase E: production cutover with feature flag and a documented rollback path
  — **pending**. Set `PAYSTACK_SECRET_KEY` to a live key and the live webhook
  URL in the Paystack dashboard; the code path is identical in both modes.
