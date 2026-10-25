# Dropshipping governance, availability & pricing foundation

**Status:** implemented in code, **not applied to any production database**. This
document describes the first dropshipping operations phase: supplier approval,
product review, stock freshness, confidential costing, and the schema that later
order/purchase/return phases use.

## Scope of this phase

- Additive migration `prisma/migrations/20261025120000_dropshipping_supplier_governance/migration.sql`.
- Matching `prisma/schema.prisma` models and enums (Prisma Client regenerated locally).
- Pure, testable rules for KES pricing, stock freshness, supplier fulfilment
  transitions, returns and payout holds.
- Admin supplier registration + manual business/commercial verification + approval,
  with audit events on every status change.
- Admin product submission/review/approval/rejection/suspension/removal and
  append-only manual stock/cost/delivery verification.
- Seller catalog with an explicit stock-snapshot classification and a
  verified-seller-only server-side profit/margin preview.
- Checkout snapshots the supplier product association onto `order_items`.
- No Paystack, settlement, payout, or buyer-protection behaviour changed.

## What is deliberately NOT automatic

| Concern | Current safeguard |
|---|---|
| Supplier approval | Requires an `ADMIN`/`SUPER_ADMIN` session, same-origin guard, reason, and completed manual business/commercial verification. |
| Product publication | Submitted products start `DRAFT` or `PENDING_REVIEW`; approval requires an approved supplier and recorded stock, cost and delivery-charge verification. |
| Imported listings | Always `DRAFT`; sellers must add an image and review the margin before publishing. |
| Stock | A dated last-known snapshot. Unknown/stale stock can be imported with a visible caveat but is never a reservation; final availability is confirmed at fulfilment. |
| Pricing | No invented tax/commission/payment/supplier rates. Missing rates are zero **and** reported as an estimate with warnings. |
| Repricing | Verified cost changes recalculate private cost snapshots only; `Product.priceCents` never changes automatically. |
| Supplier feeds | Only a `manual` adapter exists. `SUPPLIER_API`/`SUPPLIER_FEED` verification fails with HTTP 501 until a real adapter is implemented and verified. |
| Payments | No supplier payment provider, escrow or automated spending. Purchase records are manual and audited. |
| Delivery | A supplier "dispatched" claim does not mark an order delivered; delivery requires admin-reviewed evidence. |

## Data model additions

- `suppliers`: business/contact identifiers, manual verification notes/actor,
  approval timestamps, delivery counties, dispatch/delivery estimates, return
  terms, payment terms, supplier-payment responsibility and commercial-terms
  verification timestamp. All of these are admin-only.
- `supplier_products`: approval workflow (`DRAFT → PENDING_REVIEW → APPROVED`,
  with `REJECTED`, `SUSPENDED`, `REMOVED`), reviewer/note/timestamps, stock
  status/verification time/method, cost status/verification time, known supplier
  delivery charge and its verification time, and `manual_refresh_required`.
- `supplier_product_verifications`: append-only snapshot history.
- `supplier_listing_costs`: private per-listing cost/profit/margin snapshot,
  including the fee-config version and warnings. Never selected for buyers.
- `order_items`: `supplier_product_id`, `supplier_product_title`, `supplier_sku`
  snapshots written during the existing checkout transaction.
- `supplier_fulfilments`, `supplier_fulfilment_events`, `supplier_purchases`,
  `supplier_return_requests`: tables for the next phases, with unique
  idempotency keys and FKs to existing orders, payments/refunds and buyer
  protection cases.

Money is integer minor units (KES cents). No FX conversion is performed. The
application rejects non-KES supplier costs in pricing calculations rather than
inventing a rate.

## Manual supplier onboarding (no public self-registration)

1. An administrator signs in and creates the supplier through
   `POST /api/admin/suppliers`. The supplier starts `PENDING`; contact/business
   fields are stored only in the admin boundary.
2. The administrator verifies the business registration, KRA PIN (if supplied),
   contact details, delivery locations, dispatch/delivery estimates, return
   terms, payment terms and who pays the supplier through out-of-band channels.
3. `PUT /api/admin/suppliers/[id]` records/updates those terms and sets
   `commercialTermsVerifiedAt` when `commercialTermsVerified: true`.
4. `PATCH /api/admin/suppliers/[id]` moves `PENDING → APPROVED` (or
   `REJECTED`). Approval is refused with HTTP 422 and a list of missing
   requirement categories if manual verification is incomplete.
5. Every create/terms/status change writes an `AuditLog` event with actor id,
   action, target id and non-confidential metadata.

## Product review and refresh

- `POST /api/admin/suppliers/[id]/products` creates a product as `DRAFT` or
  `PENDING_REVIEW` with `stock_status = UNKNOWN`, `cost_status = ESTIMATED`,
  `manual_refresh_required = true`.
- `POST /api/admin/supplier-products/[id]/verify` records a manual stock/cost/
  delivery-charge verification. It writes an append-only history row, updates
  the last-known snapshot, marks the item refreshed, audits the change, and
  recalculates KES listing cost snapshots. It does **not** publish, reprice,
  place a purchase order, or call a supplier API.
- `PATCH /api/admin/supplier-products/[id]` applies `APPROVE`, `REJECT`,
  `SUSPEND`, `REMOVE` or `RESUBMIT` with a required note and an audit event.
  Approval requires an approved supplier and all three verification timestamps.
- `GET /api/admin/supplier-products` provides a paginated review queue with
  status, supplier, search and stale-product filters.

Legacy supplier products are backfilled as `APPROVED` so existing seller imports
keep working, but with `UNKNOWN` stock, `ESTIMATED` cost,
`manual_refresh_required = true` and no verification timestamp. Administrators
must refresh them before relying on availability or profit numbers.

## Pricing rules

`src/lib/dropshipping/pricing.ts` uses BigInt integer cents and half-up
basis-point rounding. `resolveCommissionRule()` reuses the existing
`CommissionRule` precedence (active SELLER > CATEGORY > DEFAULT, with effective
date windows). The calculation includes supplier cost, known supplier delivery
charge, seller-paid fulfilment cost, platform commission, configured payment fee
and configured tax. It reports `estimatedCostCents`, `estimatedGrossProfitCents`,
`marginBps`, `isEstimate`, `configVersion` and warnings.

Only these **non-secret, server-side** environment variables are read:

| Name | Default | Meaning |
|---|---|---|
| `DROPSHIPPING_PAYMENT_FEE_BPS` | `0` | Processor fee in basis points of retail price. Set only from a signed provider schedule. |
| `DROPSHIPPING_TAX_BPS` | `0` | Applicable tax in basis points. Set only after a documented tax decision. |
| `DROPSHIPPING_FEE_CONFIG_VERIFIED` | `false` | Business sign-off that the exact values above are correct. |
| `DROPSHIPPING_STOCK_MAX_AGE_HOURS` | `48` | Freshness threshold for warnings; never a guarantee. |

Invalid values fail safe to zero/default and add a warning. Client components
never read these variables; `POST /api/seller/supplier-products/[id]/pricing-preview`
is same-origin protected, requires a verified seller, and returns derived
profit/margin/fee amounts only — never the raw supplier cost/contact/notes.

## Migration safety and operator checklist

The migration is additive and includes a **preflight** before creating its new
unique index on `(seller_id, supplier_product_id)`: if a target database has
duplicate non-`REMOVED` rows, the transaction aborts with a clear message instead
of partially applying DDL. The earlier migration
`20261025110000_unique_seller_supplier_product` used `IF NOT EXISTS` but had no
duplicate preflight; run the read-only query below before deploying either
migration.

```sql
-- Read-only. Run against the target branch DB with an operator account.
SELECT p.seller_id,
       p.supplier_product_id,
       array_agg(p.id ORDER BY p.created_at, p.id) AS product_ids,
       array_agg(p.status ORDER BY p.created_at, p.id) AS statuses
FROM products p
WHERE p.supplier_product_id IS NOT NULL
  AND p.status <> 'REMOVED'
GROUP BY p.seller_id, p.supplier_product_id
HAVING COUNT(*) > 1;
```

If rows are returned, do not deploy. An operator must first resolve the
duplicates (normally keep the oldest DRAFT and mark the rest `REMOVED`) in a
reviewed, audited data-fix. Also verify:

```sql
SELECT migration_name, finished_at
FROM "_prisma_migrations"
WHERE migration_name LIKE '20261025%'
ORDER BY migration_name;

SELECT COUNT(*) FROM supplier_products
WHERE approval_status = 'APPROVED' AND stock_verified_at IS NULL;
```

The second query lists legacy products needing a manual refresh. No automatic
backfill can safely claim that stock or cost is current.

### Rollback

There is no automatic down migration. A rollback requires a separately reviewed
compensating migration that drops the new tables, indexes, enum types and
columns **only after** confirming no operational fulfilment/purchase/return rows
depend on them. Dropping columns on `order_items`, `order_shipments`, etc. is
destructive; do not include it in a routine deploy rollback. Keep the previous
application version compatible with additive columns until the compensating
migration is accepted.

## Verification performed locally

- `npx prisma validate` (placeholder local URLs; no DB contacted) — valid.
- `npx prisma generate` — Prisma Client v6.2.1 generated for static checks.
- All SQL migrations except the unrelated `pg_trgm` search-vector migration were
  applied in order to a fresh local PGlite/WASM Postgres instance; the new
  migration applied successfully. PGlite lacks the `pg_trgm` extension, so that
  unrelated migration was skipped in this local syntax check only.
- The duplicate preflight was exercised separately: with two non-`REMOVED`
  products sharing `(seller_id, supplier_product_id)` seeded before the new
  migration, it aborted with
  `Dropshipping uniqueness preflight failed: 1 duplicate ... group(s) exist`.
  The earlier `20261025110000` index was also confirmed to reject those rows.
- `npm test`, `npm run type-check`, `npm run lint` — see PR test evidence.
- No Neon/production DB was contacted; migration application on production is
  **unverified**. No external supplier, courier or Paystack call was made.

## Remaining dependencies

- Business-approved fee/tax/payment-responsibility decisions and provider rate
  schedules.
- Supplier contracts, credentials and verified API/feed documentation before any
  adapter is implemented.
- Courier tracking/delivery evidence process and an admin rota for manual
  refresh, fulfilment exceptions, disputes and returns.
- A legal/commercial decision on who funds supplier purchases and how supplier
  refunds are reconciled.


## Production deployment status update — 2026-10-25

A later Vercel production deployment for commit `83a33a55ba0eccaa48dfa6053789954752ffc4da` ran after PR #61 was merged. Its build log reported nine migrations found and explicitly logged:

`Applying migration `20261025120000_dropshipping_supplier_governance``

The same deployment completed successfully. The build log also warned that `DIRECT_URL` was empty and that the migration runner fell back to the pooled `DATABASE_URL`. Therefore, the earlier statement that production migration status was unverified is superseded by this deployment evidence: the production build attempted and reported applying this migration. The exact database state must still be confirmed with a read-only migration-state query before any further database operation.

No follow-up migration, data repair, production environment change, or redeployment should be run as part of this PR. See PR #64 for a guard that disables automatic production migrations by default and refuses pooled-URL fallback when explicit opt-in is enabled.
