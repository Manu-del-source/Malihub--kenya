-- Merchandising campaigns foundation.
-- Campaigns group existing products; sale pricing is deliberately excluded
-- until the checkout/order price lifecycle can enforce it end-to-end.
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'ENDED', 'CANCELLED');

CREATE TABLE "campaigns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "campaign_products" (
    "campaign_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "campaign_products_pkey" PRIMARY KEY ("campaign_id", "product_id")
);

CREATE UNIQUE INDEX "campaigns_slug_key" ON "campaigns"("slug");
CREATE INDEX "campaigns_status_starts_at_ends_at_idx" ON "campaigns"("status", "starts_at", "ends_at");
CREATE INDEX "campaigns_created_by_id_created_at_idx" ON "campaigns"("created_by_id", "created_at");
CREATE INDEX "campaign_products_product_id_idx" ON "campaign_products"("product_id");
CREATE INDEX "campaign_products_campaign_id_sort_order_idx" ON "campaign_products"("campaign_id", "sort_order");

ALTER TABLE "campaigns"
  ADD CONSTRAINT "campaigns_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "campaign_products"
  ADD CONSTRAINT "campaign_products_campaign_id_fkey"
  FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "campaign_products"
  ADD CONSTRAINT "campaign_products_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
