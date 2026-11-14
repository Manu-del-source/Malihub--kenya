CREATE TABLE "delivery_addresses" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "label" TEXT NOT NULL DEFAULT 'Home',
  "recipient_name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "county" TEXT NOT NULL,
  "sub_county" TEXT,
  "town" TEXT NOT NULL,
  "area" TEXT,
  "building" TEXT,
  "landmark" TEXT,
  "instructions" TEXT,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "default_key" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "delivery_addresses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "delivery_addresses_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "delivery_addresses_user_id_created_at_idx"
  ON "delivery_addresses"("user_id", "created_at");

-- A nullable key allows many non-default addresses but only one default per user.
CREATE UNIQUE INDEX "delivery_addresses_default_key_key"
  ON "delivery_addresses"("default_key");
