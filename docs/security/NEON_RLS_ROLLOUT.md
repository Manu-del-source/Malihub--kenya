# Neon PostgreSQL RLS rollout

## Status: foundation only — RLS is not enabled

This branch adds a transaction-local context helper and an opt-in FastAPI dependency.
It does not create or enable row-level-security policies, and it does not claim
that all MaliHub queries are tenant-isolated. Do not enable policies or change
production database roles/environment variables as part of this work.

MaliHub has two database clients: Prisma in Next.js and SQLAlchemy in FastAPI.
Both must use a trusted internal `public.users.id` in the same transaction as
every protected query. Neon Auth's token subject is the provider identity, not
the internal MaliHub user id.

## Required before enabling policies

1. Use a dedicated test database/branch and verify the application runtime role
   has `rolsuper = false`, `rolbypassrls = false`, and is not the owner of
   protected tables. An earlier validation role had `BYPASSRLS = true`; it
   cannot be used to validate enforcement.
2. Decide and implement identity bootstrap: the mapping from provider subject
   to `users.auth_user_id` happens before the internal id is known. Do not
   trust a client-provided id or grant broad access to the users table to work
   around this.
3. Inventory every protected table and all reads/writes across Next.js Server
   Actions, Route Handlers, FastAPI routes, background work, and admin flows.
4. Integrate context only after trusted identity resolution, and ensure every
   protected query uses the transaction/session that received the context.
5. Define explicit policies for public active listings, seller-owned inventory,
   buyer/seller order visibility, staff access, payments, payouts, supplier
   cost/contact details, moderation, and audit data. Default private.
6. Test with two users and the actual non-owner runtime role: cross-account
   read/write denial, buyer/seller order access, staff authorization,
   provisioning, rollback, and pooled-connection reuse.
7. Run the full frontend/backend CI and repeat the tests against an isolated
   database branch. Only after successful evidence should a separate production
   migration/runtime-role plan be reviewed.

## Current safety boundary

No RLS policies are enabled by this helper. No production migration, database
role, environment variable, or live data is changed. A green build alone is not
evidence that RLS enforces isolation.
