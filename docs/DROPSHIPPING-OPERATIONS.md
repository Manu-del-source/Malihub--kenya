# Dropshipping operations — implementation and runbook

**Date:** 2026-10-25  
**Status:** code implemented on the feature branch; **no production migration,
deployment, supplier integration or Paystack change has been applied**. This is
the operator-facing companion to `docs/DROPSHIPPING-GOVERNANCE-PHASE.md`,
`docs/DROPSHIPPING-CATALOG-PHASE1.md`, `docs/DROPSHIPPING-SELLER-IMPORT.md`
and `docs/ORDER-LIFECYCLE.md`.

## 1. What was reused

- The existing single-seller `Order`, `OrderItem`, `Payment`, `Refund`,
  `Settlement`, `Payout`, `OrderShipment`, `BuyerProtectionCase`, `AuditLog` and
  `Notification` models.
- The existing Paystack collection path, signed webhook, authenticated status
  verification, `settleSuccessfulPayment`, `markOrderPaid` and pure order/payment
  state machines. No client callback or unverified browser claim can mark an
  order paid.
- `getCurrentUser()` / `isAdministratorRole()` from the Neon Auth seam,
  `verifySameOrigin`, `logAuditEvent`, `notifyUser`, `CommissionRule`, Zod,
  Prisma 6 and the existing dashboard shell.
- The PR #59/#60 seller catalog and DRAFT import flow, extended with approval,
  freshness and pricing gates rather than rebuilt.

## 2. Architecture and data model

```
Admin -> Supplier (PENDING..APPROVED) -> SupplierProduct (DRAFT..APPROVED)
                                      -> manual stock/cost verification history
Verified seller -> DRAFT Product (supplierProductId) -> private SupplierListingCost
Buyer -> existing checkout -> Order(PENDING) -> Paystack -> verified PAID
       -> one SupplierFulfilment per supplier-sourced OrderItem
       -> SupplierPurchase (manual, one per fulfilment)
       -> SupplierFulfilmentEvent timeline
       -> BuyerProtectionCase / Refund / SupplierReturnRequest
```

Important invariants:

- `Order` stays single-seller. Multiple suppliers for one customer order are
  supported by creating **one `SupplierFulfilment` per `OrderItem`**, not by
  relaxing the order ownership rule.
- `OrderItem` stores `supplier_product_id`, `supplier_product_title` and
  `supplier_sku` snapshots at checkout. A later supplier product removal does
  not rewrite what the buyer ordered.
- `SupplierFulfilment.order_item_id` is unique. This is the idempotency key that
  makes duplicated webhooks, verification retries and admin recovery converge
  on one supplier order.
- `SupplierPurchase.fulfilment_id`, `purchase_reference` and its deterministic
  `idempotency_key` are unique. No retry can create a second financial record.
- `SupplierReturnRequest.fulfilment_id` and `idempotency_key` are unique; a
  `Refund` request uses `supplier-return-refund:<returnRequestId>` as its
  idempotency key.
- All money columns are integer minor units. No FX conversion is implemented.
  Pricing rejects non-KES supplier costs rather than inventing a rate.

## 3. Supplier onboarding, approval and product review

See `docs/DROPSHIPPING-GOVERNANCE-PHASE.md` for the API sequence. In short:

1. Admin creates a supplier (`PENDING`) and manually verifies legal identity,
   contacts, delivery counties, estimates, return/payment terms and who pays the
   supplier.
2. Admin records those terms and approves the supplier. Approval is refused
   until manual verification fields are complete, and every change is audited.
3. Admin submits supplier products as `DRAFT`/`PENDING_REVIEW`. They are never
   seller-visible on submission.
4. Admin records a manual stock/cost/delivery verification, then approves,
   rejects, suspends, removes or resubmits the product. Approval requires an
   approved supplier and all verification timestamps.
5. Legacy approved products remain importable but are explicitly `UNKNOWN`
   stock / `ESTIMATED` cost / `manual_refresh_required = true` until refreshed.

No supplier self-registration, credential storage, API key or live supplier
feed is implemented. `SUPPLIER_API` / `SUPPLIER_FEED` verification methods fail
closed with HTTP 501 until a documented, verified adapter exists.

## 4. Import, publishing and pricing

- `GET /api/seller/supplier-products` returns only `APPROVED` products from
  `APPROVED` suppliers, with an `availability` object. It never selects
  supplier cost, delivery charge, contacts, notes, review notes or feed keys.
- `classifySupplierAvailability` marks stock as `AVAILABLE`, `LIMITED`,
  `UNKNOWN`, `STALE` or `UNAVAILABLE`. Every result has `isSnapshot: true`,
  `isGuaranteed: false` and `requiresFulfilmentConfirmation: true`.
- `POST /api/seller/supplier-products/[id]/pricing-preview` is same-origin
  protected and available only to **verified sellers**. It returns derived
  profit/margin/fee estimates, not raw supplier cost or contact data.
- `calculateDropshippingPricing` uses BigInt integer cents, half-up basis-point
  rounding and the existing `CommissionRule` precedence. Missing tax/payment
  rates are zero **and** flagged; no rate is invented.
- `POST /api/seller/supplier-products/[id]/import` creates a `DRAFT` product,
  stores a private `SupplierListingCost` snapshot, and returns an estimate and
  stock caveat. The seller must still add an approved image, verify details and
  publish manually.
- A verified cost/delivery change recalculates cost snapshots only. It never
  changes `Product.priceCents` or republishes a listing.

### Server-side configuration (non-secret)

`DROPSHIPPING_PAYMENT_FEE_BPS`, `DROPSHIPPING_TAX_BPS`,
`DROPSHIPPING_FEE_CONFIG_VERIFIED`, `DROPSHIPPING_STOCK_MAX_AGE_HOURS`.
Defaults are `0`, `0`, `false`, `48`. Set the first three only from a signed
provider schedule and a documented tax decision. Client components never read
these values.

## 5. Order and supplier fulfilment lifecycle

### 5.1 Creation from verified payment

`settleSuccessfulPayment` — the canonical finalizer used by both the signed
webhook and authenticated status verification — calls
`ensureSupplierFulfilmentsForPaidOrder` **after** the order transition commits.
It is best-effort: a failure is audited as
`supplier_fulfilment.creation_failed` and can be recovered with:

```
POST /api/admin/orders/[id]/supplier-fulfilments/ensure
```

The fan-out never changes payment status, never pays a supplier, and never
creates a second task for the same order item.

### 5.2 Status machine

```
AWAITING_PAYMENT
  -> AWAITING_SUPPLIER_CONFIRMATION   (verified payment, SYSTEM only)
  -> CONFIRMED                         (seller confirms availability + final cost)
  -> ORDERED                           (seller records supplier order after purchase confirmation)
  -> DISPATCHED                        (seller records carrier + tracking)
  -> IN_TRANSIT
  -> DELIVERED                         (ADMIN only, with reviewed delivery evidence)
```

`FAILED` and `CANCELLED` are explicit exception states. A `FAILED` task can be
reopened only by an administrator with a reason (`RETRY`). A seller cannot
cancel a paid fulfilment task. Every transition is claimed with a conditional
`updateMany` on the current status, recorded in an idempotency-keyed
`SupplierFulfilmentEvent`, audited, and followed by notifications.

**Delivery rule:** a supplier dispatch claim is never proof of delivery. Only an
administrator can record `DELIVERED`, with evidence. That updates
`OrderShipment` and `Order.deliveredAt`; it does **not** set
`payoutEligibleAt` or an inspection deadline automatically, because no approved
inspection-window rule exists in this repository.

### 5.3 Seller and admin screens

- `/seller/supplier-orders` lists the seller's own supplier fulfilment tasks,
  purchase status, return status, cost snapshots, overdue dispatch and action
  controls.
- `/admin/dropshipping` shows supplier/product approval counts, stale products,
  overdue tasks, failed purchases, unresolved disputes, a paginated exception
  queue and admin delivery/cancel/retry controls.
- Buyer order detail shows only the buyer-safe projection: status, product,
  courier/tracking and an honest message. It never shows supplier identity,
  cost, purchase references, internal notes or delivery evidence.

## 6. Supplier purchasing and financial controls

1. `CONFIRM_AVAILABILITY` requires the seller to enter the final supplier unit
   cost. It creates exactly one `SupplierPurchase` in `PENDING_CONFIRMATION`
   with the supplier's payment responsibility and terms.
2. `POST /api/supplier-fulfilments/[id]/purchase` with `CONFIRM` records an
   authorized purchase order. It refuses when the final cost, payment
   responsibility or payment terms are unverified. It does **not** call a
   provider, move money or claim escrow.
3. `RECONCILE` records a manual payment/receipt reference and an audited
   comparison with `Order.totalCents`. It can record a supplier refund amount.
   `FAIL` records a supplier failure with a reason.
4. `RECORD_PURCHASE` is allowed only after the purchase is `CONFIRMED` and
   requires a supplier order reference.
5. `REPORT_FAILURE` / `CANCEL` move the purchase to `FAILED` / `CANCELLED`.
   `RETRY` returns it to `PENDING_CONFIRMATION`. No duplicate row is created.

Unresolved commercial decisions remain: who funds supplier purchases, whether
MaliHub ever pays a supplier, supplier refund handling, and legal seller-of-record
responsibilities. Do not enable live supplier ordering until these are signed
off.

## 7. Returns, refunds, disputes and payout holds

- A buyer can submit one return/dispute request per supplier fulfilment via
  `POST /api/buyer/supplier-returns`. Ownership is checked server-side.
- The request opens (or reopens) the existing single
  `BuyerProtectionCase` for the order and writes
  `supplier_return.payout_hold` audit events. `isSupplierPayoutHoldActive`
  returns true for OPEN/UNDER_REVIEW cases, unresolved returns and pending
  refunds. This is a **guard**, not a payout service and not escrow.
- Admin transitions: `REQUESTED → APPROVED → ITEM_RETURNED → REFUND_PENDING →
  RESOLVED`, with `REJECTED` / `CANCELLED` exits. Resolution requires a note.
- Moving to `REFUND_PENDING` creates **at most one** `Refund` row with status
  `PENDING` and a deterministic idempotency key. No provider refund API call
  is made and no money is guaranteed.
- `REFUND_PENDING → RESOLVED` requires the linked `Refund.status` to be
  `COMPLETED` in the database. A client cannot assert refund completion.
- Resolving closes/resolves the buyer-protection case according to the recorded
  responsibility (`SUPPLIER`, `SELLER`, `COURIER`, `BUYER`, `PLATFORM` or
  `UNDETERMINED`). No payout is released automatically.

## 8. Notifications and audit

Notifications use the existing `notifyUser` service:

- Seller: new paid supplier task, status changes, purchase status, return
  request and payout hold.
- Buyer: payment-confirmed/availability, dispatch, tracking, failure,
  delivery, return/dispute status and refund-pending status.
- Admins: task creation exceptions, repeated/terminal failures, cancellations,
  new return requests and refund-pending cases.

Audit actions are defined in `src/services/audit-service.ts` and include
supplier create/status/terms, product submit/approve/reject/suspend/remove/
stock verification, listing-cost recalculation, fulfilment creation/status/
failure, purchase confirmation/failure/reconciliation, and return
request/status/payout-hold events. Metadata contains ids, statuses and counts
only — never supplier costs, contacts, credentials or evidence text.

## 9. API summary

| Method | Path | Audience | Purpose |
|---|---|---|---|
| GET/POST | `/api/admin/suppliers` | Admin | Paginated supplier registry / create PENDING supplier |
| GET/PUT/PATCH | `/api/admin/suppliers/[id]` | Admin | Supplier detail / terms / status decision |
| GET/POST | `/api/admin/suppliers/[id]/products` | Admin | Supplier product list / submission |
| GET | `/api/admin/supplier-products` | Admin | Paginated review queue |
| PATCH | `/api/admin/supplier-products/[id]` | Admin | Approve/reject/suspend/remove/resubmit |
| POST | `/api/admin/supplier-products/[id]/verify` | Admin | Manual stock/cost/delivery verification |
| GET | `/api/seller/supplier-products` | Active seller | Approved catalog + availability |
| POST | `/api/seller/supplier-products/[id]/pricing-preview` | Verified seller | Derived profit/margin estimate |
| POST | `/api/seller/supplier-products/[id]/import` | Verified seller | Create DRAFT listing |
| GET | `/api/seller/supplier-fulfilments` | Verified seller | Own supplier order queue |
| POST | `/api/supplier-fulfilments/[id]/transition` | Seller/Admin | Authorized fulfilment transition |
| POST | `/api/supplier-fulfilments/[id]/purchase` | Seller/Admin | Manual purchase confirm/fail/reconcile |
| POST | `/api/buyer/supplier-returns` | Buyer | Create return/dispute request |
| GET | `/api/admin/supplier-fulfilments` | Admin | Paginated exception queue |
| PATCH | `/api/admin/supplier-returns/[id]` | Admin | Return decision |
| GET | `/api/admin/supplier-returns` | Admin | Return/dispute queue |
| POST | `/api/admin/orders/[id]/supplier-fulfilments/ensure` | Admin | Idempotent task recovery |

All mutations have same-origin CSRF checks, session/role authorization, UUID
and Zod validation, and code-only error logging.

## 10. Migrations, verification and rollback

One additive migration was created for this work:
`prisma/migrations/20261025120000_dropshipping_supplier_governance/migration.sql`.
It was validated with `npx prisma validate` and applied (with the rest of the
migrations) to a fresh local PGlite/WASM Postgres instance for SQL syntax
checking. It has **not** been applied to Neon or production.

Before deploying, run the read-only duplicate preflight and migration-state
queries in `docs/DROPSHIPPING-GOVERNANCE-PHASE.md`. Resolve duplicate
`(seller_id, supplier_product_id)` rows before applying
`20261025110000_unique_seller_supplier_product`. There is no automatic down
migration; rollback requires a separately reviewed compensating migration.

`next build` runs `scripts/deploy-production-migrations.mjs`, which applies
`prisma migrate deploy` only in Vercel Production builds. Do not run a
production build until the migration preflight and business sign-offs are
complete.

## 11. Tests and checks

Local checks on the feature branch (no DB credentials, no external calls):

- `npm test` — see PR body for the exact final count; includes new pricing,
  freshness, state-machine, admin governance, API authorization and supplier
  order lifecycle tests.
- `npm run type-check` — 0 errors.
- `npm run lint` — 0 errors / 0 warnings.
- `npx prisma validate` — valid with placeholder local URLs.
- `npx prisma generate` — Prisma Client v6.2.1 generated for static checks.
- Local PGlite migration apply — succeeds for the new migration; unrelated
  `pg_trgm` search-vector migration skipped because that extension is not
  available in PGlite.
- `npx next build` — see PR body; requires env placeholders and does not contact
  a database in a non-production environment.
- No browser preview smoke test, live Paystack call, supplier API call or
  production migration-state verification was performed.

## 12. Limitations and production blockers

- No supplier credentials, APIs, feeds, courier integrations, webhooks or
  automated tracking exist. All refresh, purchase and tracking is manual.
- No automatic supplier payment, escrow, payout split, refund provider call,
  repricing, publishing or supplier order placement.
- No approved tax rate, processor fee schedule, FX rule, inspection-window
  length or supplier-payment responsibility. Estimates stay labelled as such.
- Buyer protection, settlement and payout models are reused as workflow
  records; this code does not claim funds are held and does not implement a
  payout release service.
- Admin and seller operations need an operational rota for manual refresh,
  overdue tasks, evidence review, disputes, supplier refunds and reconciliation.
- Production migration state, duplicate rows, live webhook retries and
  cross-seller isolation must be verified in a staging database before launch.
