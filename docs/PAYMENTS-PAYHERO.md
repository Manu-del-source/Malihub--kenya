# PayHero M-Pesa collection (Phase 9.2-A + 9.3)

Server-side M-Pesa STK Push collection for buyer checkout orders. A buyer
pays for a PENDING order with M-Pesa, PayHero delivers the result to our
callback, and the order becomes PAID — atomically, idempotently, and with a
durable audit trail. Phase 9.2-A built the pipes (initiation, callback,
verification); **Phase 9.3 hardened the complete Order ↔ Payment lifecycle**:
the invariants below now hold under attempts, retries, duplicates, stale
callbacks, races, and cancellations.

Scope remains deliberately narrow. **Collection only.** No refunds, payouts,
settlements, commission splits, or seller payment accounts — those phases
build on the Payment rows this one books (see *Remaining work*).

## Components

| Layer | File | Responsibility |
| --- | --- | --- |
| Provider client | `src/lib/payments/payhero.ts` | The *only* file that speaks PayHero HTTP. Config, request building, timeout, response normalization, typed errors, safe logging. |
| Payment state machine | `src/lib/payment-state-machine.ts` | Pure legality table for `Payment.status` moves (terminal-first-wins). Documentation + defense-in-depth; the conditional claims enforce. |
| Initiation, settlement & verification | `src/services/payment-service.ts` | Order-authoritative initiation (attempt cap), advisory-lock-serialized success claims with sibling guard, the canonical `settleSuccessfulPayment` finalizer, transaction-status verification/recovery. |
| Callback pipeline | `src/services/payment-callback-service.ts` | Idempotent, race-safe settlement of provider results; duplicate-replay recovery. |
| Order state machine | `src/lib/order-state-machine.ts`, `src/services/order-transition-service.ts` | Untouched authorities for PENDING→PAID and PENDING→CANCELLED; payment code drives them, never bypasses. |
| Initiation route | `src/app/api/payments/payhero/stk/route.ts` | Authenticated buyer endpoint (session + same-origin + per-buyer STK rate limit). |
| Callback route | `src/app/api/payments/payhero/callback/route.ts` | Server-to-server endpoint PayHero POSTs to. |

The FastAPI backend's PayHero adapter remains a typed stub returning 501 —
the backend plays no role in collection this phase.

## Configuration

Four required server-side env vars (validated in `payhero.ts`; the service
fails with `provider_not_configured` if any is missing or malformed):

| Variable | Purpose |
| --- | --- |
| `PAYHERO_API_URL` | PayHero base URL. Production: `https://backend.payhero.co.ke/api/v2`. |
| `PAYHERO_AUTH_TOKEN` | Basic-auth token from the PayHero dashboard, sent verbatim as `Authorization: Basic <token>`. Never logged, never client-visible, never committed. |
| `PAYHERO_CHANNEL_ID` | Your registered PayHero payment channel id (integer). There is no automatic channel selection. |
| `PAYHERO_CALLBACK_URL` | The publicly reachable URL of **this deployment's** callback route. Handed to PayHero at initiation. |

Optional: `PAYHERO_TIMEOUT_MS` (default 15000, clamped 1000–60000; invalid
values throw at config time, they never silently fall back).

`PAYHERO_CALLBACK_URL` naming note: it is called "PRODUCTION CALLBACK URL" in
the provider context, but any deployment (staging included) can use any HTTPS
URL — it just must be *publicly reachable*, because a provider cannot POST to
localhost. For local development, tunnel (e.g. ngrok) or use the verification
service with a real reference created through a tunnelled initiation.

## Payment lifecycle

```
BUYER                    MALIHUB                              PAYHERO
  │  POST /stk {orderId}   │                                   │
  │ ─────────────────────► │ 1. auth, own order, payable       │
  │                        │ 2. reserve Payment row            │
  │                        │    (amount/phone/reference from   │
  │                        │    Order + session ONLY)          │
  │                        │ 3. POST /payments ──────────────► │ STK push to phone
  │   QUEUED (pending!) ◄─ │ 4. Payment PROCESSING,            │
  │                        │    Order still PENDING            │
  │                        │         … buyer enters PIN …      │
  │                        │ ◄── POST /callback (result)       │
  │                        │ 5. idempotent settlement:         │
  │                        │    Payment SUCCESS + Order PAID   │
```

Key invariants:

- **`ExternalReference` = `Payment.customerReference` = the order number**
  (`MH-…`) for the first attempt, and the deterministic `{orderNumber}-R{n}`
  for attempt `n` (input `n` = attempt number, so the first retry is `-R2`).
  It is generated server-side from confirmed stock, persisted before PayHero
  is called, and echoed back in the callback. PayHero's own `reference` is
  *also* stored (`metadata.payhero.reference`) for verification lookups.
- **QUEUED ≠ paid.** A QUEUED initiation response leaves the Payment
  PROCESSING and the order PENDING. Only a validated callback (or explicit
  verification) settles anything.
- **One authoritative amount.** The charge is always the order's
  `totalCents` (integer minor units; `/100` exactly once, at the provider
  boundary). Client-supplied amounts are ignored.
- **Resumable, not duplicable.** If the app crashes between reserving the
  row and the provider call, the retry *resumes the same row and reference*.
  If the provider reported failure, the retry books a **new** attempt so the
  audit trail never rewrites one attempt with another's outcome.
- **Double-click safe.** Concurrent initiations are serialized with a
  Postgres advisory transaction lock keyed on the order id, producing
  exactly one STK push no matter how many tabs or retries stack up.
- **Bounded retries.** At most `MAX_PAYMENT_ATTEMPTS_PER_ORDER` (5) attempts
  may be *created* per order (joining/resuming an active attempt is never
  capped), and the STK route adds a per-buyer sliding-window limit
  (10 initiations/5 min, via the existing fail-open Upstash limiter) against
  cross-order spam.

## Order ↔ Payment lifecycle (Phase 9.3)

```
              one Order
                 │
   ┌─────────────┼──────────────────┐
   ▼             ▼                  ▼
 attempt A    attempt B          attempt C     …one Payment row per attempt
 PROCESSING   FAILED             CANCELLED     (never rewritten)
   │             │                  │
   ▼             └── retry ─────────┘   order still PENDING
 SUCCESS
   │
   ▼
 Order PENDING ──▶ PAID ──▶ SHIPPED ──▶ DELIVERED ──▶ COMPLETED
```

- **Attempts are first-class.** One `Payment` row per attempt; terminal
  attempts (FAILED/CANCELLED) are never mutated — a retry creates a new row
  with `retryCount + 1` and a fresh deterministic reference.
- **Payment cancellation ≠ order cancellation.** Result code `1032` (the
  buyer canceling the STK prompt) ends the *attempt* as CANCELLED and is
  audited as `payment.cancelled`; the *order* stays PENDING and payable.
  Order cancellation is the separate buyer action in Phase 9.1 (state
  `CANCELLED`, inventory restored once, audited as `order.cancelled`).
- **At most one effective successful payment per order — enforced under
  lock.** Two attempts can both be provider-visible (a prompt paid after we
  recorded a cancellation, a timed-out STK that succeeded anyway) and each
  can attract a success callback. The success claim takes the same
  order-keyed advisory lock initiation uses; concurrent claims serialize and
  the loser sees the winner's committed SUCCESS sibling and is refused
  (`ignored: order_already_settled` / verification outcome `superseded`).
  This is a database conditional claim under a lock — not an
  `if (order.status === "PAID")` check between transactions.
- **Stale callbacks settle nothing.** A success arriving for an obsolete
  attempt (foreign `CheckoutRequestID`, or any attempt after a sibling
  settled) cannot touch the winning row or the order: it is recorded as an
  IGNORED PaymentEvent and audited as `payment.anomaly`
  (`superseded_success`) for the reconciliation/refund phase, because the
  provider may have collected real money twice.
- **The payment state machine is explicit** (`src/lib/payment-state-machine.ts`):
  `PENDING → PROCESSING/SUCCESS/FAILED/CANCELLED`,
  `PROCESSING → SUCCESS/FAILED/CANCELLED`, everything else terminal —
  enforced by the conditional claims, documented and asserted by the pure
  module. Terminal-first-wins: a late provider success can never resurrect a
  FAILED/CANCELLED attempt; the contradiction is an anomaly, not a rewrite.
- **PROCESSING is neither success nor failure, and nothing times it out.**
  An abandoned QUEUED prompt keeps the attempt PROCESSING: it never settles
  anything, never blocks the order's other transitions, re-initiation
  *joins* it instead of pushing again, `GET /transaction-status`
  verification is the recovery channel (QUEUED → still pending; SUCCESS →
  settles exactly like a callback; FAILED → marks the attempt failed), and
  no background job guesses outcomes. A later phase may sweep for
  verification — that sweep uses the same claims.
- **Settlement is a two-step operation with a self-healing window.** The
  payment claim commits first; the `PENDING → PAID` order transition follows
  in `markOrderPaid` (post-commit side effects stay honest). If the process
  dies between the steps, the next observer heals it: a *replayed* callback
  (otherwise a pure duplicate) and a status verification on a settled
  payment both re-run the idempotent transition. No new effect, exact
  recovery.
- **Cancellation race: exactly one winner, no double inventory.**
  `PENDING → CANCELLED` (with stock restore) and `PENDING → PAID` are both
  compare-and-set on the same gate; a success that arrives after the cancel
  keeps the Payment SUCCESS (the money really arrived), leaves the order
  CANCELLED, and audits `payment.anomaly: order_cancelled` — *without*
  restoring inventory again and without a "paid" notification.
- **Audit trail.** `payment.initiated`, `payment.success` (exactly once per
  payment — replays and recoveries never re-emit), `payment.failed`,
  `payment.cancelled`, `payment.amount_mismatch`, `payment.anomaly`, plus
  the order-level `order.paid` / `order.cancelled`. Metadata carries
  references and amounts only — never tokens, phones, or payloads.
- **Notifications are post-commit and deduplicated.** Success notifies
  buyer+seller through `markOrderPaid` exactly once (its `changed` gate
  swallows replays); failure/cancellation notifies the buyer once per
  attempt; a cancel-won race produces *no* contradictory "paid"
  notification.

## Callback pipeline

`POST /api/payments/payhero/callback` — server-to-server, **no session, no
origin check** (PayHero is not a browser; this is deliberate). Trust comes
entirely from the data:

1. **Persist the PaymentEvent first.** `providerEventId` is derived
   deterministically from an immutable provider transaction identifier
   (`stk-callback:{CheckoutRequestID}`) — never a UUID or timestamp. The
   unique `[provider, providerEventId]` constraint is the dedup ledger: a
   unique violation means "already delivered" and the outcome is the
   **duplicate path**, however many times PayHero retries.
2. **Find the payment.** `CheckoutRequestID` → `providerTransactionId`;
   on a miss, one bounded fallback by `ExternalReference` →
   `customerReference` (covers the crash window where PayHero knows a
   CheckoutRequestID we never persisted — the row is then backfilled).
3. **Reject foreign transactions.** A callback claiming one of our
   references but carrying a **different** CheckoutRequestID (the
   double-STK-prompt race) is `unknown_reference`: the event is kept for
   forensics and *nothing* settles. One STK transaction emits exactly one
   terminal result; a sibling transaction's callback must never stamp the
   winner's row.
4. **Verify the amount.** The callback KES amount must equal
   `Payment.amountCents / 100` as integers. Any mismatch settles nothing and
   writes a `payment.amount_mismatch` audit event — treat those as fraud
   signals.
5. **Interpret honestly.** `Status: "Success"` **and** `ResultCode: 0`
   together mean SUCCESS; any other combination is a failure, with
   `ResultCode`/`ResultDesc` recorded verbatim (`1032` → reason code
   `CANCELLED`).
6. **Settle once — and only one *per order*.** The success claim runs
   inside the event-recording transaction **under the order-keyed advisory
   lock** (the same key initiation serializes on), so concurrent success
   settlements for sibling attempts pass a single gate. Inside the gate the
   row is re-read; a sibling already SUCCESS means this attempt is
   `superseded` and produces no effect (`ignored:
   order_already_settled`). First terminal result wins per attempt
   (`payment_already_terminal`, `contradicts_terminal_state`), and the
   winning claim hands off to the canonical finalizer
   (`settleSuccessfulPayment`) which drives the existing order state
   machine and the once-only `payment.success` audit.

Event payloads are stored **redacted** (phone → `[redacted]`); the verbatim
payload lives only on `Payment.rawCallbackPayload`, which is the internal
reconciliation record.

## Payment vs. cancellation race

Phase 9.1's rule stands: **PENDING→PAID and PENDING→CANCELLED are mutually
exclusive.** Both are compare-and-set `updateMany` on the same
`status: PENDING` gate; exactly one wins. If the buyer (or expiry) cancelled
first, the money still arrived — the callback keeps the Payment SUCCESS
(truthful: the provider did collect) but the order stays CANCELLED, and a
`payment.anomaly` audit event (`order_cancelled`) flags the one state a
human must resolve: *paid for a cancelled order*. That resolution is the
refund phase's job; this phase detects and records, never invents.

## Failure catalogue

| Where | Code | Meaning | Buyer-visible? |
| --- | --- | --- | --- |
| initiation | `not_found` | wrong/invisible order id | 404 |
| initiation | `not_payable` | order not PENDING (e.g. cancelled) | 409 |
| initiation | `already_paid` | the order is already PAID | 409 |
| initiation | `attempt_limit` | the order's payment attempts are exhausted | 429 |
| initiation | `rate_limited` | per-buyer sliding window tripped | 429 |
| initiation | `invalid_amount` | order total is not positive integer cents | 400 |
| initiation | `phone_required` / `phone_invalid` | no usable Kenyan MSISDN | 400 |
| initiation | `provider_not_configured` | missing/invalid PAYHERO_* config | 503 |
| initiation | `provider_rejected` | PayHero accepted the request but declared failure | 502 |
| initiation | `provider_unavailable` | network/timeout/5xx — **retry later, same reference** | 503 |
| initiation | `provider_invalid_response` | shape not per contract | 502 |
| callback | `invalid_payload` | not the documented envelope | 400 (never settled) |
| callback | `unknown_reference` | no such payment / foreign CheckoutRequestID | 200, recorded only |
| callback | `amount_mismatch` | callback amount ≠ booked amount | 200, recorded + audit |

Route responses never echo provider internals, order internals to
non-owners, or config values; generic `400/401/403/404/409/503` carry short
stable messages for the UI.

## Verification service

`verifyPayheroPaymentStatus` (in `payment-service.ts`) reconciles a stuck
PROCESSING payment against `GET /transaction-status?reference=…`, where the
reference is the PayHero-issued one stored at initiation
(`metadata.payhero.reference` — e.g. `PYH-Q59RB2FPRO`), *not* our order
number. It:

- settles SUCCESS through the **same canonical finalizer** the callback
  uses (same claim, same order CAS, same once-only audit),
- refuses to claim when a **sibling attempt already settled** the order —
  outcome `superseded`, no second effect, anomaly audited,
- books FAILURE with the provider's own status word (e.g. `Failed`,
  `Canceled`) as the failure code, never inventing a result,
- treats QUEUED/pending words as "still pending" and **settles nothing**,
- refuses to downgrade a locally terminal payment (a later provider reading
  cannot un-pay a buyer) — and performs **no provider round-trip** for a
  locally terminal row at all,
- on a locally SUCCESS payment, silently **heals the crash window** (re-runs
  the idempotent order transition before answering `already_success`),
- reports unknown raw status words back without guessing,
- is safe against the callback landing mid-verification (the advisory lock
  plus conditional claims make one of them a no-op).

Use it from a UI "check status" button or a cron reconciler sweeping stale
PROCESSING payments.

## Security model

- **Server-derived everything.** Amount, channel id, provider, callback URL,
  and user identity come from config/session/database. Client input is
  exactly two fields: `orderId` and an optional `phoneNumber` (used only if
  it passes Kenyan MSISDN validation; otherwise the account phone is used).
- **Buyer-scoped authorization.** Initiation requires a session, the order
  must belong to the session user, and wrong-order probes get the same 404
  as missing orders (no existence oracle).
- **Same-origin on the browser route; none on the callback route.** The STK
  route enforces the existing origin guard; the callback route is a public
  server-to-server endpoint whose inputs are validated against our own
  ledger, so a forged payload can at worst produce a recorded
  `unknown_reference` event.
- **Secrets hygiene.** The Basic token appears in exactly one place (the
  outbound `Authorization` header). Logs carry references, statuses, and
  codes only — never tokens, full phone numbers, or full payloads. Event
  payloads are redacted at rest; the verbatim payload is only on the Payment
  row.
- **Idempotency as a ledger.** Duplicate callbacks are detected by a
  database unique constraint, not by request comparison, so retry storms and
  concurrent deliveries cannot double-settle.
- **Audit trail.** `payment.initiated`, `payment.success`, `payment.failed`,
  `payment.callback_ignored`, `payment.amount_mismatch`, and
  `payment.anomaly` AuditEvents make the whole lifecycle reconstructable.

## Local testing & operations

- The full suite mocks only the PayHero HTTP boundary; no test ever holds a
  real token or sends a real STK push.
- To exercise real M-Pesa locally: set the four env vars, expose the dev
  server through a tunnel, and point `PAYHERO_CALLBACK_URL` at
  `{tunnel}/api/payments/payhero/callback`.
- If callbacks seem lost: check `PaymentEvent` for unprocessed rows, then
  run verification by order number; check `payment.amount_mismatch` and
  `payment.anomaly` audit events; confirm `PAYHERO_CALLBACK_URL` points at
  the deployment you paid against.

## Explicitly out of scope (Phases 9.2-A/9.3 — Phase 9.4+ candidates)

Seller payment accounts, KYC, payouts/settlements, commission, refunds and
reversals (the `payment.anomaly` rows this phase detects — `order_cancelled`,
`superseded_success`, `payment.amount_mismatch` — are the refund phase's
work queue, nothing here resolves them), dashboards, a PROCESSING-sweep
background job (verification is on-demand by design), webhooks for providers
other than PayHero, and any Daraja direct integration. The
`PaymentProvider.DARAJA` enum value remains reserved so adding an adapter
later is a code change, not a migration. The backend adapter stays a stub —
do not wire it to these routes.
