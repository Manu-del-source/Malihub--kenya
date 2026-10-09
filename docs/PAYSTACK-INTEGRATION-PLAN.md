# Paystack integration plan — MaliHub Kenya

## Status

The server-only API client foundation lives in `src/lib/payments/paystack.ts`.
It supports transaction initialization, server-side verification, strict checkout
URL validation, timeouts, and HMAC-SHA512 verification of Paystack webhook
signatures. It is not yet wired into checkout or the order settlement pipeline.

## Required configuration

Set these variables in local development and the Vercel project environment.
Use the Paystack **Test Mode** secret key first; do not commit secrets.

- `PAYSTACK_SECRET_KEY`: server-only `sk_test_...` key for testing.
- `PAYSTACK_CALLBACK_URL`: absolute HTTPS URL for the buyer return page.
- `PAYSTACK_TIMEOUT_MS`: optional outbound timeout, defaults to 15000.

The webhook should be configured separately in Paystack Dashboard → Settings /
API Keys & Webhooks to point at the MaliHub webhook endpoint once that endpoint
is implemented and deployed.

## Payment flow to implement

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

MaliHub intends to collect buyer payments and later pay independent sellers.
Collection and seller payouts are separate financial flows. Before enabling live
payments, obtain written approval from Paystack for this marketplace model and
confirm the available payout product, seller onboarding/KYC requirements,
fees, settlement timing, refunds, chargebacks, reserves, and reconciliation.
Do not represent an ordinary merchant collection account as an approved
payment-aggregation arrangement. Never pay sellers based only on the browser
return URL.

## Rollout sequence

- Phase A: client foundation and configuration (current).
- Phase B: provider-neutral database enum/migration, initiation route, callback
  route, status verification, checkout UI wiring, and unit tests.
- Phase C: test-mode end-to-end tests for success, failure, duplicates,
  amount mismatch, invalid signature, timeout, and concurrent attempts.
- Phase D: seller ledger/payout workflow only after compliance approval; require
  reconciliation and manual review for payout exceptions.
- Phase E: production cutover with feature flag and a documented rollback path.
