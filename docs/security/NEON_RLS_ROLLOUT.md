# Neon PostgreSQL RLS rollout — implementation status

## Safety boundary

This rollout is being developed on an isolated branch and must not change the
production database or production environment variables until the complete
authorization path has been verified. The application has two database clients:
Prisma in Next.js and SQLAlchemy in FastAPI. Enabling row-level security before
both clients reliably establish trusted transaction context can break normal
requests or, worse, create policies that do not cover all access paths.

## Current change

`backend/app/core/rls_context.py` provides a small SQLAlchemy helper that sets
`app.user_id` using PostgreSQL's transaction-local `set_config(..., true)`.
The caller must pass the internal MaliHub `users.id` only after the provider
identity has been verified and mapped. The value must never come from a request
parameter or client-controlled header. The setting ends when the transaction
ends and therefore does not persist across pooled-connection reuse.

A unit test covers rejecting a missing identity and the parameterized,
transaction-local SQL call.

**This helper alone does not enable or complete RLS.** It is not yet wired into
the authenticated FastAPI dependency lifecycle or Prisma's user-scoped
transactions. No broad RLS policies should be applied until those integrations
and the role tests below are complete.

## Required next steps

1. Confirm the dedicated runtime role is not a superuser, table owner with RLS
   bypass, or a role with `BYPASSRLS`; do not use owner/admin connections for
   application-level policy tests.
2. Map the actual reads/writes for users, profiles, sellers, products, orders,
   order items, payments, settlements, payouts, protection cases, supplier
   catalog/imports/fulfilment/returns, campaigns, and admin workflows.
3. Decide how identity bootstrap and account provisioning work under RLS. The
   initial lookup by provider subject occurs before the internal user id is
   known; do not solve this by trusting client-supplied ids or granting broad
   user-table access.
4. Integrate transaction-local context into FastAPI after trusted identity
   resolution and into Prisma transactions for user-scoped operations. Audit
   every protected query path and transaction boundary.
5. Add policies with explicit public-read rules (e.g. only active public
   listings), owner-scoped writes, buyer/seller order visibility, and trusted
   staff access. Treat payment, payout, supplier cost/contact, and internal
   moderation data as private by default.
6. Test as the actual non-owner runtime role: anonymous/public reads, two users
   attempting cross-account reads/writes, seller ownership, buyer/seller order
   access, staff authorization, provisioning, transaction rollback, and pooled
   connection reuse.
7. Verify policy behavior and app tests on an isolated Neon branch. Only then
   plan a separately reviewed production migration and runtime-role/environment
   change.

## Neon branch note

The earlier validation work used isolated branch
`br-jolly-scene-aqruvu1f`. The existing `products_public_read_active` policy
on that branch should be independently inspected and tested before relying on
it. It is not evidence that the rest of the schema is protected.
