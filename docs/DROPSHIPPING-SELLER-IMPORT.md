# Dropshipping Seller Sourcing and Import

This document outlines the seller-facing supplier catalog, sourcing workflow, and product import API in MaliHub.

## Sourcing Model Overview

MaliHub supports a seller-led dropshipping model:
1. **Supplier Product**: A catalog item from a MaliHub-approved Kenyan or international supplier. Supplier costs (`costMinor`), contact emails, phone numbers, and internal notes are operational data and are strictly confidential.
2. **Seller Imported Draft**: An inventory item created in the seller's own catalog via the import workflow. It begins strictly as a `DRAFT` listing with `publishedAt = null`.
3. **Published Listing**: A public marketplace listing created once the verified seller reviews the draft, confirms supplier availability and lead times, uploads verified product images via MaliHub storage, and publishes the listing.

## API Endpoints

### 1. GET `/api/seller/supplier-products`

Retrieves active products from approved suppliers for authenticated sellers to browse and source.

#### Authorization and Security
- Requires a signed-in, active, non-banned user.
- Requires an existing seller profile in the `sellers` table.
- Never serializes or exposes `costMinor`, supplier contact details, or internal admin notes.

#### Query Parameters
- `q` (optional string): Case-insensitive search across product title, description, and SKU.
- `region` (optional enum): Filter by supplier region (`KENYA` or `INTERNATIONAL`).
- `page` (optional integer, default `1`): 1-based page number.
- `limit` (optional integer, default `24`, max `50`): Results per page.

#### Response Structure (200 OK)
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "title": "Solar Lantern Pro",
      "description": "High-efficiency solar lantern with USB output.",
      "sku": "SKU-SOLAR-01",
      "sourceUrl": "https://supplier.example.com/item/01",
      "imageUrl": "https://supplier.example.com/images/solar.jpg",
      "currency": "KES",
      "availableQuantity": 150,
      "lastSyncedAt": "2026-10-25T08:00:00.000Z",
      "supplier": {
        "id": "uuid",
        "name": "Nairobi Solar Distributors",
        "region": "KENYA",
        "countryCode": "KE"
      },
      "importedListing": null
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 24,
    "total": 1,
    "totalPages": 1
  },
  "sellerVerified": true
}
```

If the authenticated seller has already imported the supplier product, `importedListing` contains `{ id, slug, status }`.

---

### 2. POST `/api/seller/supplier-products/:id/import`

Imports an approved supplier catalog item as a seller-owned draft listing.

#### Authorization and Security
- Requires a signed-in, active, non-banned user.
- Requires `verificationStatus = VERIFIED` on the seller record. Unverified or pending sellers cannot import items.
- Enforces same-origin (CSRF) header validation.

#### Request Body
```json
{
  "categorySlug": "electronics",
  "priceCents": 250000,
  "county": "Nairobi",
  "town": "Westlands",
  "quantity": 2
}
```

#### Fields Validation
- `categorySlug` (string): Must match a valid, active category in MaliHub.
- `priceCents` (integer): Retail price in KES cents (100 to 2,000,000,000 cents).
- `county` (enum): Must match one of the 47 Kenyan counties in `KENYA_COUNTIES`.
- `town` (string): Town or sub-county name (2 to 80 characters).
- `quantity` (integer): Listing stock count (1 to 9999, default 1).

#### Response Codes
- `201 Created`: Draft created successfully. Returns `{ success: true, data: { id, title, slug, status, priceCents, createdAt }, message: string }`.
- `400 Bad Request`: Input validation failure, malformed JSON, or invalid category slug.
- `401 Unauthorized`: User is not authenticated.
- `403 Forbidden`: Account is inactive/banned, seller record is missing, seller is unverified, or CSRF validation failed.
- `404 Not Found`: Supplier product does not exist, is inactive, or its supplier is not in `APPROVED` status.
- `409 Conflict`: The seller already imported this supplier product into their active inventory.
- `500 Internal Server Error`: Generic safe server error without leaking database connection strings or internals.

---

## Database Uniqueness and Concurrency

To ensure race safety under concurrent requests:
1. **Application-level check**: An initial check queries `prisma.product.findFirst` for existing non-removed listings for the seller and supplier product pair.
2. **Database-level constraint**: Enforced via a partial unique index in `prisma/migrations/20261025110000_unique_seller_supplier_product/migration.sql`:
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS "products_seller_supplier_product_unique"
     ON "products" ("seller_id", "supplier_product_id")
     WHERE "supplier_product_id" IS NOT NULL AND "status" != 'REMOVED';
   ```
3. **Prisma error handling**: The import route explicitly catches Prisma unique constraint violations (`P2002`) and returns a standard `409 Conflict` response with message `"You have already imported this supplier product."`.

---

## Listing Completion and Publishing Safety

- Imported items are stored with status `DRAFT` and `publishedAt = null`.
- They do not appear on public marketplace searches or category pages until published.
- The seller listing editor at `/seller/listings/[id]/edit` detects supplier-sourced listings and displays a sourcing warning banner.
- Sellers must upload verified product images through MaliHub storage and verify title, description, retail price, stock, category, and location details before setting status to `ACTIVE`.
- No automatic supplier orders, buyer charges, payment splitting, or automated fulfillment tasks are triggered at import time.

---

## Validation and Test Verification

Run all checks locally using the repository scripts:

```bash
# Type check
npm run type-check

# Lint check
npm run lint

# Unit and integration test suite
npm test

# Production build
npm run build
```

## Known Limitations and Operational Risks

- Manual supplier fulfillment: Supplier purchasing and dispatch confirmation remain manual operational tasks in this phase.
- Stock availability: Supplier `availableQuantity` reflects the last recorded snapshot and is not real-time inventory reservation. Sellers must confirm supplier stock before publishing high-volume listings.
- Image licensing: Supplier-provided preview images must be reviewed and replaced by the seller's own verified photos uploaded through MaliHub's storage pipeline.
