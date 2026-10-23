# MaliHub buyer protection — implementation boundary

## Scope of this foundation PR

This is a staged buyer-protection workflow, **not escrow**. No new payment provider behavior is claimed, no money is held by these tables, and this change must not be advertised as escrow or a payment guarantee.

### Planned order lifecycle

1. Buyer places and pays for an order through the existing provider-verified payment flow.
2. Seller records the courier/carrier and tracking number; shipment state is recorded separately from payment state.
3. A trusted courier delivery update (or an explicitly reviewed admin confirmation when a carrier integration is unavailable) records delivery. A seller-submitted status alone must not be described as independently verified.
4. MaliHub sets the inspection-window end time from the configured policy. This timestamp only represents *payout eligibility*, not a payout command.
5. Buyer can open one protection case for the order during the eligible window, selecting a reason and providing evidence.
6. Any open or under-review case blocks payout eligibility. Only a documented resolution and policy check can restore eligibility.
7. Seller payout remains subject to the existing settlement/payout workflow and a separately approved provider arrangement. No automatic release is implemented by this schema change.

## Data model

- `OrderShipment`: one courier tracking record per order.
- `BuyerProtectionCase`: one case per order for the MVP, with reason, status, timestamps and resolution note.
- `BuyerProtectionEvidence`: evidence metadata linked to a case and authenticated submitter.
- `Order.deliveredAt`, `inspectionEndsAt`, `payoutEligibleAt`: workflow timestamps only.

## Security and acceptance requirements before launch

- Enforce buyer ownership on case creation and evidence; seller/admin views must be separately authorized.
- Validate carrier/tracking fields server-side; never trust a client-provided delivery timestamp to unlock payouts.
- Evidence upload must go through the authenticated storage flow; restrict file types and sizes and protect private evidence URLs.
- Create audit events for shipment status changes, case opening, evidence addition, resolution and any payout eligibility changes.
- Apply an inspection duration configured on the server, not supplied by the buyer/seller.
- A case in OPEN or UNDER_REVIEW must block payout processing in the payout service, not merely hide a button.
- Never call a payment provider or mark a payout complete from a delivery webhook. Provider-confirmed payout status remains authoritative.
- Add migration validation, Prisma generation, type-check, lint, unit/integration tests and preview end-to-end tests before merge.
- Confirm courier integration and payment-provider delayed-release capabilities before enabling real payout delays or making consumer protection promises.

## Explicit non-goals

- No escrow, custodial balance, wallet, or claim that Paystack holds funds.
- No automatic seller payout/release.
- No live production database migration, production deployment, or live payment changes in this PR.
