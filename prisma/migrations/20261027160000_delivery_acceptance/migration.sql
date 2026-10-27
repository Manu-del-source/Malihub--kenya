-- Additive follow-up to the PR's quote groundwork. Existing orders are not
-- backfilled as accepted: an unrecorded buyer consent must never be invented.
ALTER TABLE "orders"
  ADD COLUMN "delivery_estimate_cents" INTEGER,
  ADD COLUMN "delivery_fee_accepted_at" TIMESTAMPTZ,
  ADD COLUMN "delivery_quote_version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_delivery_estimate_cents_nonnegative"
    CHECK ("delivery_estimate_cents" IS NULL OR "delivery_estimate_cents" >= 0),
  ADD CONSTRAINT "orders_delivery_quote_version_nonnegative"
    CHECK ("delivery_quote_version" >= 0),
  -- A quote written before versions existed is preserved unchanged, even if
  -- its note exceeds the new limit. Every versioned quote obeys the limit.
  ADD CONSTRAINT "orders_delivery_quote_note_length"
    CHECK ("delivery_quote_version" = 0 OR "delivery_quote_note" IS NULL OR char_length("delivery_quote_note") <= 500),
  -- Version 0 with no acceptance is a legacy/unaccepted row. For new
  -- acceptance or versioned quotes, enforce the same states as the service.
  -- Cast before addition so an invalid sum cannot overflow INTEGER in a check.
  ADD CONSTRAINT "orders_delivery_consent_consistent"
    CHECK ((
      ("delivery_quote_version" = 0 AND "delivery_fee_accepted_at" IS NULL)
      OR
      ("delivery_quote_version" = 0 AND "delivery_fee_status" = 'ESTIMATED'
        AND "delivery_fee_accepted_at" IS NOT NULL
        AND "delivery_estimate_cents" IS NOT NULL
        AND "delivery_estimate_cents" = "delivery_fee_cents"
        AND "delivery_quote_cents" IS NULL
        AND "total_cents"::bigint = "subtotal_cents"::bigint + "delivery_fee_cents"::bigint)
      OR
      ("delivery_quote_version" > 0 AND "delivery_fee_status" = 'QUOTED'
        AND "delivery_fee_accepted_at" IS NULL
        AND "delivery_quote_cents" IS NOT NULL AND "delivery_quote_updated_at" IS NOT NULL)
      OR
      ("delivery_quote_version" > 0 AND "delivery_fee_status" = 'CONFIRMED'
        AND "delivery_fee_accepted_at" IS NOT NULL
        AND "delivery_quote_cents" IS NOT NULL AND "delivery_quote_updated_at" IS NOT NULL
        AND "delivery_fee_cents" = "delivery_quote_cents"
        AND "delivery_fee_accepted_at" >= "delivery_quote_updated_at"
        AND "total_cents"::bigint = "subtotal_cents"::bigint + "delivery_fee_cents"::bigint)
    ) IS TRUE);
