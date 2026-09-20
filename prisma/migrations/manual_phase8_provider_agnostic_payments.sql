-- ============================================================================
-- Phase 8: provider-agnostic payments + the audit_logs table Phase 7 expected.
--
-- WHO NEEDS THIS FILE
--   Only a database that already exists at the Phase 7 shape. A fresh database
--   gets everything straight from `prisma migrate dev` / `prisma db push`
--   against prisma/schema.prisma — do NOT run this file in that case.
--
-- WHY IT IS MANUAL
--   This repo has no committed Prisma migration history (see README), so the
--   applied shape of a live database comes from `db push`. Renaming a Postgres
--   enum *value* and moving data between columns before dropping them are both
--   things `db push` would happily do destructively (drop + recreate the
--   column, losing the data). Written by hand, this is data-preserving.
--
-- WHAT IT DOES
--   1. Creates `audit_logs`. Phase 7 shipped services/audit-service.ts
--      (`prisma.auditLog`) and manual_phase7_security.sql (RLS on
--      `public.audit_logs`), but the Prisma model never landed in the schema,
--      so the table was never created and that RLS script would have failed
--      with "relation does not exist". The model is in schema.prisma now; this
--      is the matching DDL for an existing database.
--   2. Generalizes `payments` off M-Pesa-specific columns onto provider-neutral
--      ones. Mapping:
--        mpesa_checkout_request_id → provider_transaction_id
--        mpesa_receipt_number      → provider_reference
--        mpesa_phone_number        → payer_reference
--        result_code               → failure_code  (int → text)
--        result_desc               → failure_reason (only where not already set)
--        mpesa_merchant_request_id → metadata->>'merchantRequestId'
--   3. Adds `provider` and a required `customer_reference`.
--   4. Drops the old columns.
--
-- BEFORE YOU RUN IT
--   * Take a backup. Step 4 is irreversible.
--   * Phase 6's M-Pesa work was never implemented (no services/mpesa.ts, no
--     /api/mpesa/* handler — those directories hold only .gitkeep), so
--     `payments` is expected to be EMPTY. Confirm that first:
--
--       select count(*), count(mpesa_checkout_request_id) from public.payments;
--
--     If it is not empty, review the `provider` backfill heuristic in step 3b
--     against your real rows before committing — it is a best-effort historical
--     attribution, not a fact.
--   * After this file, re-run `manual_phase7_security.sql` — it can now succeed.
--
-- Run once against your application Postgres (SQL editor or psql).
-- ============================================================================


-- ─── 1. audit_logs ─────────────────────────────────────────────────────────
-- No foreign keys on actor_id: an audit trail must outlive its subject, and
-- failed-login rows describe emails that never became users. See the model
-- comment in schema.prisma.

create table if not exists public.audit_logs (
  id            uuid        primary key default gen_random_uuid(),
  action        text        not null,
  actor_id      uuid,
  actor_email   text,
  target_type   text,
  target_id     text,
  metadata      jsonb,
  ip_address    text,
  user_agent    text,
  created_at    timestamptz not null default now()
);

-- Names match what Prisma generates from the @@index declarations, so a later
-- `prisma migrate diff` sees no drift.
create index if not exists "audit_logs_action_created_at_idx"
  on public.audit_logs (action, created_at);
create index if not exists "audit_logs_actor_email_created_at_idx"
  on public.audit_logs (actor_email, created_at);
create index if not exists "audit_logs_actor_id_idx"
  on public.audit_logs (actor_id);


-- ─── 2. PaymentMethod: MPESA → MOBILE_MONEY, + BANK_TRANSFER ────────────────
-- ADD VALUE cannot be executed inside a transaction block on PostgreSQL < 12,
-- so it runs first and outside the BEGIN/COMMIT below. Every supported target
-- (Supabase, Neon, RDS — all PG 13+) is fine either way; keeping it out just
-- means the script also works on an older engine.
--
-- Note the resulting value ORDER differs cosmetically from schema.prisma
-- (BANK_TRANSFER lands last rather than third). Enum ordering has no semantic
-- meaning in Postgres and Prisma does not compare it, but a `prisma migrate
-- diff` may mention it. Harmless; a fresh database gets the canonical order.
alter type public."PaymentMethod" add value if not exists 'BANK_TRANSFER';
alter type public."PaymentMethod" rename value 'MPESA' to 'MOBILE_MONEY';


begin;

-- ─── 3. PaymentProvider ────────────────────────────────────────────────────
-- 3a. The enum. DARAJA is reserved for a future direct Safaricom integration
--     and has no code behind it; MANUAL means money settled by hand.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'PaymentProvider') then
    create type public."PaymentProvider" as enum ('PAYHERO', 'DARAJA', 'MANUAL');
  end if;
end
$$;

-- 3b. New columns, all nullable while data moves across.
alter table public.payments add column if not exists provider                public."PaymentProvider";
alter table public.payments add column if not exists provider_transaction_id text;
alter table public.payments add column if not exists provider_reference      text;
alter table public.payments add column if not exists customer_reference      text;
alter table public.payments add column if not exists payer_reference         text;
alter table public.payments add column if not exists metadata                jsonb;
alter table public.payments add column if not exists failure_code            text;

-- Historical attribution for rows created before `provider` existed. Reads the
-- post-rename MOBILE_MONEY value. See the warning at the top of this file.
update public.payments
   set provider = case method
                    when 'MOBILE_MONEY'      then 'DARAJA'::public."PaymentProvider"
                    when 'CARD'              then 'PAYHERO'::public."PaymentProvider"
                    when 'BANK_TRANSFER'     then 'PAYHERO'::public."PaymentProvider"
                    else                          'MANUAL'::public."PaymentProvider"
                  end
 where provider is null;

alter table public.payments alter column provider set default 'PAYHERO';
alter table public.payments alter column provider set not null;

-- 3c. Move the M-Pesa columns into their generic counterparts. Guarded so a
--     row with nothing to migrate keeps metadata NULL rather than getting an
--     empty JSON object.
update public.payments
   set provider_transaction_id = mpesa_checkout_request_id,
       provider_reference      = mpesa_receipt_number,
       payer_reference         = mpesa_phone_number,
       failure_code            = nullif(result_code::text, ''),
       failure_reason          = coalesce(failure_reason, result_desc),
       metadata                = jsonb_strip_nulls(
                                   jsonb_build_object(
                                     'merchantRequestId', mpesa_merchant_request_id,
                                     'migratedFrom',      'phase7-mpesa-columns'
                                   )
                                 )
 where mpesa_checkout_request_id  is not null
    or mpesa_receipt_number       is not null
    or mpesa_phone_number         is not null
    or mpesa_merchant_request_id  is not null
    or result_code                is not null
    or result_desc                is not null;

-- 3d. customer_reference is NOT NULL in the schema — it's our order number,
--     which every payment has always had via order_id. Backfill from there.
update public.payments p
   set customer_reference = o.order_number
  from public.orders o
 where p.customer_reference is null
   and o.id = p.order_id;

-- Anything still NULL after that is an orphan (order deleted) — give it a
-- stable placeholder rather than failing the NOT NULL below. Should match zero
-- rows: `orders` → `payments` is onDelete: Cascade.
update public.payments
   set customer_reference = 'UNKNOWN-' || id::text
 where customer_reference is null;

alter table public.payments alter column customer_reference set not null;

-- 3e. Uniqueness moves with the columns. Postgres unique constraints permit
--     any number of NULLs, which is what a nullable provider identifier needs.
alter table public.payments
  add constraint payments_provider_transaction_id_key unique (provider_transaction_id);
alter table public.payments
  add constraint payments_provider_reference_key unique (provider_reference);

create index if not exists "payments_provider_status_idx"
  on public.payments (provider, status);


-- ─── 4. Drop the M-Pesa columns ────────────────────────────────────────────
-- IRREVERSIBLE. Everything worth keeping was copied in step 3.
alter table public.payments drop constraint if exists payments_mpesa_checkout_request_id_key;
alter table public.payments drop constraint if exists payments_mpesa_receipt_number_key;

alter table public.payments drop column if exists mpesa_checkout_request_id;
alter table public.payments drop column if exists mpesa_merchant_request_id;
alter table public.payments drop column if exists mpesa_receipt_number;
alter table public.payments drop column if exists mpesa_phone_number;
alter table public.payments drop column if exists result_code;
alter table public.payments drop column if exists result_desc;

commit;


-- ─── 5. Verify ─────────────────────────────────────────────────────────────
-- Should return no rows for either query.
--
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'payments'
--      and column_name like 'mpesa%' or (table_name = 'payments' and column_name like 'result%');
--
--   select id from public.payments
--    where provider is null or customer_reference is null;
--
-- Then re-run manual_phase7_security.sql to apply RLS to the audit_logs table
-- created in step 1.
