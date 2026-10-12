-- ============================================================================
-- Phase 10: flip the payments.provider default from PAYHERO to PAYSTACK.
--
-- WHO NEEDS THIS FILE
--   Only a database that already exists at the Phase 9 shape (default
--   'PAYHERO'). A fresh database gets the Phase 10 default straight from
--   prisma/schema.prisma via `prisma db push` / `prisma migrate dev` — do NOT
--   run this file on a fresh database.
--
-- WHY IT IS MANUAL
--   This repo keeps its applied-shape changes as reviewed manual SQL (see the
--   other manual_*.sql files). `ALTER TABLE ... ALTER COLUMN ... SET DEFAULT`
--   is ADDITIVE and NON-DESTRUCTIVE:
--     - no data is touched — historical 'PAYHERO' rows keep their value;
--     - no column is dropped or re-typed — the Postgres enum
--       "PaymentProvider" is unchanged (PAYHERO stays a valid value, which is
--       exactly what reconciliation of historical rows needs);
--     - the only effect is that NEW INSERTs omitting `provider` default to
--       'PAYSTACK'.
--   Every write path in this repository sets `provider` explicitly, so the
--   default is a belt-and-braces correctness measure, not a behavior change.
--
-- WHAT IT DOES
--   1. Verifies the current default (informational; safe to inspect by eye).
--   2. Flips the default.
--
-- ROLLBACK
--   ALTER TABLE "payments" ALTER COLUMN "provider" SET DEFAULT 'PAYHERO';
-- ============================================================================

BEGIN;

-- Informational: expected to print 'PAYHERO' on a Phase 9 database.
SELECT d.adsrc AS current_default
FROM pg_attribute a
JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE a.attrelid = '"payments"'::regclass
  AND a.attname = 'provider';

ALTER TABLE "payments"
  ALTER COLUMN "provider" SET DEFAULT 'PAYSTACK';

COMMIT;
