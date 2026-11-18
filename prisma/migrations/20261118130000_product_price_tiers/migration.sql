-- Quantity-based seller pricing. Existing products keep their current
-- price_cents as the single-unit/base price and receive no tier rows.
CREATE TABLE "product_price_tiers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "min_quantity" INTEGER NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_price_tiers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_price_tiers_min_quantity_check" CHECK ("min_quantity" >= 2),
    CONSTRAINT "product_price_tiers_unit_price_check" CHECK ("unit_price_cents" >= 100)
);

CREATE UNIQUE INDEX "product_price_tiers_product_id_min_quantity_key"
    ON "product_price_tiers"("product_id", "min_quantity");
CREATE INDEX "product_price_tiers_product_id_min_quantity_idx"
    ON "product_price_tiers"("product_id", "min_quantity");

ALTER TABLE "product_price_tiers"
    ADD CONSTRAINT "product_price_tiers_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
