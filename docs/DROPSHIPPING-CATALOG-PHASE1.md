# Dropshipping catalog foundation (Phase 1)

This phase adds a supplier catalog foundation for MaliHub's seller-led dropshipping model. It supports Kenyan and international suppliers while keeping MaliHub's existing seller-owned customer listings and single-seller-per-order checkout invariant intact.

## Data model

- `Supplier`: supplier profile, region/country, contact metadata, and an explicit approval lifecycle (`PENDING`, `APPROVED`, `REJECTED`, `SUSPENDED`).
- `SupplierProduct`: supplier catalog item, supplier-side external identifier/SKU, source URL/image, cost in integer minor units, currency, optional stock quantity, and last-sync timestamp.
- `Product.supplierProductId`: optional source link from a seller's MaliHub listing to one supplier catalog item. Existing listings remain unlinked and unchanged.

## Safety and operational constraints

- Supplier approval must be checked by any future seller sourcing/import endpoint. This schema alone does not grant a supplier access to publish listings.
- Supplier cost and currency are operational data, not customer listing price. API responses must explicitly select customer-facing fields rather than serialize supplier records or internal costs.
- No supplier API credentials are stored in these tables. Store integration secrets in the hosting secret manager.
- Stock sync is not implemented. `availableQuantity` is a last-known supplier value, not a reservation or guaranteed inventory count.
- No automatic supplier purchase is implemented. Orders must only be submitted to suppliers after a verified successful payment, with idempotency, failure handling, refunds, buyer protection, and seller settlement rules defined in the order/fulfilment phase.
- `costMinor` uses the supplier's declared currency; foreign exchange, shipping, import duties, taxes, and landed-cost/margin calculations are not implemented.
- This migration is additive. It does not change checkout, Paystack, existing orders, settlement, or payout behavior.

## Next phase

Build authenticated seller sourcing endpoints and an admin-only supplier approval/catalog management workflow. Validate role checks against the current Neon Auth session helpers and add tests before enabling any supplier data writes in production.


## Update (2026-10-25): governance and freshness added

The original Phase 1 schema remains the base, but supplier products now also
have an admin approval lifecycle, dated stock/cost/delivery verification,
`manual_refresh_required`, and an append-only verification history. The seller
catalog filters on `approvalStatus: APPROVED` and returns an `availability`
classification with `isSnapshot: true` / `isGuaranteed: false`. A
verified-seller-only pricing preview uses integer KES cents and configured
fees; no tax, commission or FX rate is invented. See
`docs/DROPSHIPPING-GOVERNANCE-PHASE.md` and
`docs/DROPSHIPPING-OPERATIONS.md`.
