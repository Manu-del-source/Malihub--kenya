# MaliHub RLS enforcement implementation tracker

## Scope and safety boundary

This rollout is intentionally isolated to `security/rls-enforcement-rollout` and the Neon branch `rls-enforcement-validation`. Do not merge to `main`, change production database policies or roles, or change production environment variables until the validation checklist is green and reviewed.

RLS must be treated as a coordinated database + application change. Enabling policies before every legitimate query path uses the correct transaction-local context and a non-bypass runtime role can break sign-in, account provisioning, public catalog pages, checkout, payment callbacks, background tasks, and admin operations.

## Confirmed baseline

Read-only inspection of the production snapshot and its validation branch found:

- 42 existing PostgreSQL RLS policies covering 41 tables.
- The inspected policy inventory contains SELECT policies only; it does not yet demonstrate INSERT, UPDATE, or DELETE enforcement.
- `payment_events` has no policy in the inspected policy inventory and requires explicit review for webhook writes and read access.
- `neondb_owner` and `malihub_rls_test` have `BYPASSRLS=true`; neither is suitable for proving enforcement.
- `malihub_rls_probe` has `BYPASSRLS=false`, but its existing policy grants are primarily read-oriented and do not establish that the application runtime is correctly configured.
- The helper implementations in `src/lib/prisma.ts` and `backend/app/core/rls_context.py` establish a transaction-local identity context only when callers explicitly use them. They do not automatically protect every route.
- The separate branch named `rls-security-validation` was previously observed not to mirror the production policy inventory. This new validation branch was created from the production branch snapshot and must be used for repeatable policy experiments.

These observations are not proof that all data is exposed or that every write is unprotected; they identify what must be verified before claiming RLS enforcement is complete.

## Identity rules

1. Verify the Neon Auth identity first.
2. Resolve the provider subject through `users.auth_user_id` to the internal `public.users.id`.
3. Set `app.user_id` transaction-locally on the same database transaction/session used for protected queries.
4. Never take RLS identity from request bodies, query parameters, or arbitrary headers.
5. Account bootstrap must have a separately designed least-privilege path because the internal user id does not exist before provisioning.
6. Webhooks and background jobs must use explicit service identities/roles and narrow operation scopes; they must not impersonate an arbitrary buyer or seller.

## Required implementation work

### A. Inventory every data path

For each table, record every read/write in Next.js Server Components, Server Actions, Route Handlers, FastAPI routes, scheduled/background tasks, admin operations, provisioning, and payment callbacks. Label the actor and intended operation (SELECT/INSERT/UPDATE/DELETE). Record whether the path uses Prisma or SQLAlchemy, the verified identity source, and the transaction carrying RLS context.

Priority domains:

- Identity bootstrap: `users`, `profiles`, seller onboarding.
- Public catalog: active products, categories, images, reviews, campaigns.
- Seller-owned data: products, supplier imports, stock/cost records, payout accounts.
- Buyer-owned data: cart, wishlist, saved searches, orders, reviews.
- Order participants: order items, shipments, messages, disputes/evidence.
- Financial data: payments, payment events, refunds, settlements, payouts, commission rules.
- Operations: support tickets, moderation, audit logs, reports, supplier administration.

### B. Policies

Use default-deny policies and explicitly decide each operation per table. Do not add broad `USING (true)` or `WITH CHECK (true)` policies for convenience.

- Public anonymous reads: only intentionally public fields/rows, such as active, approved listings and active categories/campaigns.
- Buyer/seller ownership: validate ownership through authoritative foreign keys and the current transaction-local user id.
- Writes: pair `USING` and `WITH CHECK` where applicable so users cannot change ownership fields to take over another account's rows.
- Staff/admin: check authoritative database roles; never trust a role passed by the client.
- Supplier costs, contact details, payout accounts, payment payloads, and audit records: private by default and accessible only to specifically authorized actors.
- Payment webhooks: preserve signature verification, amount/currency/provider verification, and idempotency; do not grant public access to payment event rows just to make callbacks work.

### C. Runtime roles

Create/verify a dedicated runtime role on the isolated branch with `rolsuper=false`, `rolbypassrls=false`, and no ownership of protected tables. Grant only required table/sequence/function privileges. Verify actual Next.js and FastAPI connection strings use that role in the test environment. Migration/owner credentials must not be used as application credentials.

### D. Application integration

- Migrate protected Prisma access through a wrapper that receives the internal user id only after server-side session verification and uses the provided transaction client for every protected query.
- Migrate protected SQLAlchemy routes to a dependency that sets context after identity mapping and ensures the route's queries use the yielded session.
- Keep public anonymous catalog access separate from authenticated user context; test both paths.
- Keep account provisioning, payment webhooks, and scheduled jobs as explicit, separately tested paths.
- Audit raw SQL, global Prisma client calls inside RLS transactions, nested transactions, and service functions that create their own sessions.

### E. Tests required before rollout

- Two distinct buyers cannot read or mutate each other's profiles, carts, wishlists, orders, messages, support tickets, or payment data.
- A seller can access only their own seller records and the orders/products they are authorized to handle.
- Buyer/seller order participation rules work in both directions.
- Supplier cost/contact fields are not returned to buyers or unauthorized sellers.
- Non-admin users cannot read or modify admin, commission, supplier-review, audit, or moderation records.
- Anonymous users can read only intentionally public active catalog rows.
- INSERT/UPDATE/DELETE checks reject spoofed owner IDs and owner changes.
- New-user provisioning succeeds without opening broad access to the users table.
- Valid Paystack webhook processing remains idempotent; invalid signatures, mismatched amounts/currency, unknown references, and duplicate events cannot settle payments.
- Transaction rollback clears transaction-local identity; pooled connection reuse does not leak one user's context to the next request.
- Tests run under the actual non-owner, non-BYPASSRLS runtime role, not the database owner.
- Frontend lint/typecheck/build and backend tests all pass.

## Manual work that may be required

The repository/Neon integrations cannot safely assume the deployment environment variables or production secrets. A project owner must create/verify the least-privilege runtime role and update **staging/preview only** connection strings in the hosting dashboard after the role and policies have been tested on the isolated branch. Never paste database passwords or connection strings into chat or commit them to Git.

## Exit criteria

Do not call this complete until the route/table inventory is filled in, policies cover each intended operation, both application clients use the proper role and transaction context, cross-account tests pass against the isolated Neon branch, webhook/provisioning regressions pass, and a separate production rollout plan is reviewed.
