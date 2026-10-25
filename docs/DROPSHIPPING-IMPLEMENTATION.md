# MaliHub Dropshipping Marketplace — Implementation Plan

Status: design and implementation baseline; no production behaviour changed.

## Product decision

MaliHub will support a **seller-led dropshipping marketplace**. Sellers source products from approved Kenyan and international suppliers, publish their own MaliHub listings with a controlled markup, and remain responsible for the buyer-facing sale. The supplier dispatches to the buyer where the supplier supports direct fulfilment.

The initial release uses **manual supplier operations**. Supplier API integrations, automated catalog imports and automatic purchase-order submission are later capabilities, not assumed to exist.

## Repository audit findings

Reviewed the current Prisma schema, order API, order transition service, order state machine, order lifecycle documentation, and seller guide.

- `Product` currently belongs to a MaliHub `Seller` and has a listing price and quantity; there is no dedicated supplier identity or supplier SKU/cost record.
- `Order` is deliberately single-seller. Its comments explicitly state that multi-seller carts should create one order per seller. Preserve this invariant.
- `OrderItem` stores sale-price snapshots and quantity but has no supplier cost snapshot or supplier fulfilment reference.
- `OrderShipment` supports one shipment per order. Supplier fulfilment may require multiple suppliers and therefore multiple shipments for one seller order.
- Payment, settlement, payout, refunds, inspection-window and buyer-protection models already exist. Dropshipping must integrate with these instead of bypassing them.
- The order transition service is transaction-oriented and protects cancellation/inventory operations. New supplier order creation must be idempotent and must not create supplier purchases from an unverified payment signal.
- Existing product and seller APIs, dashboards and test suites are the likely integration points. The current schema does not establish that supplier onboarding, supplier APIs or automated stock sync already exist.

## Architecture principles

1. Keep the existing storefront, checkout, Paystack payment path, authentication, order state machine and settlement flow.
2. Keep an order single-seller. A seller order can contain multiple items; fulfilment is modelled separately and can be split by supplier.
3. Use additive Prisma migrations. Do not rewrite or delete existing orders or payment records.
4. Keep money in integer minor units. Store supplier currency and exchange-rate/cost snapshots explicitly; never calculate profit from floating-point values.
5. Never expose supplier-only cost, contact details or purchase-order data to buyers or unrelated sellers.
6. Verify provider payment status server-side and make payment-to-fulfilment processing idempotent. A browser redirect alone is not proof of payment.
7. Do not describe MaliHub as holding escrow. Preserve the existing documented distinction between delivery workflow, dispute state and actual provider-held funds.
8. Make stock freshness and delivery estimates visible. If supplier availability cannot be verified, require seller confirmation before accepting an order or show a clearly defined availability caveat.
9. Begin with manual supplier operations and design an adapter boundary for future documented supplier APIs.

## Proposed data model

Exact Prisma names should be finalised alongside the migration and service design.

- `Supplier`: name, country, status, supported currencies, fulfilment regions, contact/returns details, verification and audit timestamps.
- `SupplierProduct`: supplier ID, supplier SKU, source reference, supplier cost in minor units, currency, available stock snapshot, variants, last-sync timestamp and linked MaliHub product/listing. Enforce appropriate uniqueness for supplier + SKU.
- `SupplierOrder`: internal order/fulfilment reference, seller order, supplier, idempotency key, status, supplier order reference, cost/shipping/tax snapshots, currency and timestamps.
- `SupplierOrderItem`: supplier order, source product/SKU, quantity, unit cost snapshot and variant snapshot.
- `Fulfillment` (or a carefully extended shipment model): supplier assignment, carrier, tracking reference, status, dispatch/delivery events and exception reason. Support more than one fulfilment per MaliHub order.
- `SupplierSyncLog`: import/sync attempts, source, timestamp, safe error details and outcome.
- Add explicit audit events for supplier approval, product import, cost/stock changes and supplier order actions.

Do not make these tables production-facing until migrations, access control, services and regression tests land together. Avoid storing supplier secrets or API credentials in ordinary product records.

## Phased delivery

### Phase 1 — Supplier foundation and catalog (first implementation PR)

- Add additive supplier, supplier-product and audit/sync data structures.
- Add seller/admin permissions and validation boundaries.
- Add admin supplier approval and seller-facing supplier catalog/source flow.
- Support manual supplier product entry/import, supplier SKU, country, currency, cost, stock timestamp and estimated dispatch window.
- Let a seller set a retail price and preview estimated margin before publishing.
- Keep supplier costs private from buyers and other sellers.
- Add migration, schema validation, service tests, authorization tests and documentation.
- Do not change production payment or payout behaviour.

### Phase 2 — Order and fulfilment workflow

- On verified payment, create a pending supplier-fulfilment task through an idempotent service.
- Require seller confirmation before a manual supplier purchase is marked submitted.
- Track supplier confirmation, dispatch, carrier/tracking, delivery, cancellation and exceptions.
- Permit multiple supplier fulfilments under one seller order.
- Reconcile supplier cancellation/refund outcomes with existing order/payment/refund services.
- Preserve buyer-protection dispute and inspection-window payout guards.

### Phase 3 — Operational pilot

- Pilot with a small number of verified Kenyan suppliers.
- Track stock accuracy, supplier acceptance, dispatch time, delivery success, cancellations, returns and seller margin.
- Add admin monitoring and safe retry/reconciliation tools.
- Confirm customer-facing delivery and returns disclosures before enabling wider access.

### Phase 4 — International suppliers and automation

- Add supplier country, currency conversion snapshots, international shipping estimates and explicit import-charge disclosures.
- Integrate only suppliers with documented and authorised catalog/order/tracking APIs.
- Use background jobs with retry limits, idempotency, rate limits and audit logs.
- Provide manual fallback when integrations fail.

## Acceptance criteria

- Existing checkout, Paystack webhook/reconciliation, order cancellation, settlement, payout and buyer-protection tests remain green.
- A seller cannot access another seller's supplier cost, supplier order, or private supplier relationship.
- An unapproved supplier cannot publish products to the marketplace.
- Price, stock and currency values are validated and timestamped.
- Retail price and margin calculations include supplier cost, estimated shipping, currency conversion, MaliHub commission and known payment fees; estimates are labelled as estimates.
- Replayed payment events cannot create duplicate supplier purchase orders.
- A supplier failure cannot silently mark an order as shipped or delivered.
- Multiple supplier fulfilments can be tracked without breaking the existing single-seller order invariant.
- Refunds, disputes and cancellations do not trigger an invalid seller payout.
- No production deployment or migration is performed as part of a pull request.

## Operational decisions needed before live supplier ordering

- Who pays the supplier and when: seller pays directly, or a supported marketplace payout flow is explicitly designed. Do not assume MaliHub can split/hold funds without a supported provider capability.
- Who is the seller of record and responsible for consumer disclosures, taxes and refunds.
- How seller margins, MaliHub commission, shipping, import costs and currency conversion are calculated and disclosed.
- Which supplier identities and product categories are accepted, and what evidence is required for verification.
- Which suppliers provide direct-to-customer shipping, tracking, returns and an authorised API.

## Scope of this document

This is a repository-grounded implementation plan, not evidence that supplier tables, dashboards or fulfilment integrations already exist. Work should proceed in a separate feature branch and pull request, with production untouched until review, tests and explicit release approval.
