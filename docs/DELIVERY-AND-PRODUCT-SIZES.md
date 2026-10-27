# Delivery estimates, quotes and product sizes

## Configuration and units

`MALIHUB_DELIVERY_COUNTY_RATES_JSON` is a **server-only** JSON object mapping
canonical Kenya county names to non-negative integer **KES minor units**
(100 cents = KSh 1). Configure actual, operator-approved rates only. A test
fixture such as `{"Nairobi":25000}` means KSh 250.00 **per seller order**;
it is not a recommendation or a production price. Missing county rates,
missing/malformed JSON, unknown county keys, negative, fractional, and values
outside PostgreSQL's 32-bit integer range fail closed. A configured zero is
valid only when explicitly intended. No routing/distance provider is integrated;
distance-based pricing is unsupported and no distance is inferred.

## Checkout and quote lifecycle

* A cart becomes **one order per seller**. The county rate is intentionally
  charged once per seller order. Checkout shows the rate, number of sellers,
  delivery sum and complete total; the buyer explicitly accepts the rate and
  count. The server recalculates both before reserving stock and snapshots the
  original estimate and the acceptance. If the cart/rate changes, acceptance
  must be repeated. Prices and all totals are server-derived.
* The seller owning a pending order can enter a KSh quote and an optional
  **buyer-visible** note (not private operational notes) from Seller → Orders.
  Each changed quote receives a new version, invalidates consent, and notifies
  the buyer in-app. The order page shows the proposed fee and revised total.
  The buyer accepts the exact current amount and version; the server updates
  the fee and total transactionally. Accepting a quote does not pay the order.
* A buyer may pay an accepted estimate if no revised quote has arrived. Payment
  initialization checks the current quote version, acceptance, items, subtotal,
  fee, total, ownership, order status and existing payment attempts. It reserves
  a single attempt under the same order-scoped database lock used by quote
  changes, acceptance, cancellation and payment settlement. A changed quote or
  stale page cannot start payment. Each order is paid separately on Paystack.
* Once **any** payment attempt has been started, delivery and self-service
  cancellation are locked even if the provider later reports failure: this
  integration cannot revoke an already-issued hosted checkout or prove its
  link expired. One compatible active attempt with a saved access code can be
  resumed only if it is the order's sole attempt. An ambiguous attempt without
  a code or an order with multiple attempts requires review. The app does not create a
  second reference after a failed/cancelled attempt. Contact support to
  reconcile the existing checkout; there is no automated release/retry flow
  until the provider's expiry or revocation guarantees are integrated. Unknown
  or abandoned provider states are not silently treated as failed. A verified
  success contradicting a terminal failure is recorded and audited for support
  rather than silently presented as a paid order.
* Historical orders receive **no fabricated acceptance or rate** in the
  migration. A pending order without recorded consent cannot start a new
  payment until its seller submits a quote and the buyer accepts it; an
  unversioned older quote must be reissued, even if unchanged. Where a payment
  was already attempted, the price is locked and support/reconciliation is
  required. Existing provider callbacks can still be verified normally.

## Product sizes

Sizes are optional. The listing form accepts one size, a size system (UK, US,
EU, CLOTHING or OTHER), and/or a comma-separated list of available sizes. The
same validation runs in the form and server boundaries; values are trimmed,
duplicate available sizes are removed, and malformed input is rejected. Editing
initializes all existing size fields, duplication preserves them, and public
product details show both single and available sizes when present.

The migrations are additive and must be reviewed and applied separately from
a build. This document does not authorize a production migration, configuration
change, deployment, or a change to existing production data.
