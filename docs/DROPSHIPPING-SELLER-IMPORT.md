# Dropshipping seller import API

## Endpoint

`POST /api/seller/supplier-products/:id/import`

The route creates a MaliHub seller-owned **draft** listing linked to an approved supplier catalog item. It does not publish the listing, purchase stock from the supplier, charge a buyer, or change checkout/payment behavior.

## Authentication and validation

- Requires a signed-in, active, non-banned user.
- Requires an existing seller profile with `verificationStatus = VERIFIED`.
- Enforces same-origin/CSRF validation for the mutation.
- Accepts `categorySlug`, `priceCents`, `county`, `town`, and optional `quantity`.
- Validates the category and county against existing application data.
- Rejects inactive supplier products and products whose supplier is not approved.
- Rejects an import if the seller already has a non-removed listing linked to that supplier product.
- Stores the seller's retail price separately from the supplier's private cost.
- Uses a generated unique slug and sets listing status to `DRAFT`.

## Request example

```json
{
  "categorySlug": "fashion",
  "priceCents": 250000,
  "county": "Nairobi",
  "town": "Westlands",
  "quantity": 1
}
```

`priceCents` is the retail price in KES cents (250000 = KSh 2,500). The chosen category slug must exist in MaliHub; the example is illustrative.

## Response behavior

- `201`: draft created.
- `400`: malformed or invalid input/category.
- `401`: sign-in required.
- `403`: seller setup/verification or account access requirement not met.
- `404`: supplier product unavailable or supplier not approved.
- `409`: seller already imported the supplier product.
- `500`: unexpected persistence or server failure.

## Deliberate limitations

- This route creates drafts only. It does not make them visible in the public marketplace.
- A seller must add an image uploaded through MaliHub's approved image-upload flow and review the listing before publishing. Supplier image URLs are not copied directly into listing images.
- Supplier cost, supplier contact data, and internal notes are not returned to sellers.
- No supplier purchase, inventory reservation, currency conversion, shipping quote, customs/tax calculation, or payout is performed.
- Duplicate detection is an application-level check. If concurrent import requests must be guaranteed race-safe, add a database uniqueness constraint for seller + supplier product and handle the unique-constraint response.
- Run repository type-check, lint, unit tests, Prisma validation, and a preview smoke test before merge/release. Those checks have not been confirmed by this change alone.
