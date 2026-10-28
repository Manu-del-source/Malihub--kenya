# MaliHub Kenya — Sale-Readiness Audit

**Audit date:** 2026-10-28  
**Scope:** repository-level review of the current `main` branch, architecture/configuration docs, payment and dropshipping documentation, and visible outstanding pull requests.  
**Important limitation:** this is not yet a complete live-production penetration test or transaction certification. No production database, secret store, payment dashboard, or hosting configuration was accessed or changed for this review.

## Executive assessment

MaliHub has substantial implementation: Next.js 15 storefront and dashboards, Neon Managed Better Auth, Prisma/PostgreSQL, a FastAPI service, Cloudinary image storage, Redis-backed realtime infrastructure, Paystack payment flows, and seller-led dropshipping workflows. The repository also has regression tests and payment threat-model documentation.

**It is not yet defensible to describe the whole product as sale-ready.** The largest gaps are proof of production behaviour, an end-to-end security boundary across both application services, reproducible CI for both frontend and backend, and a buyer-facing handover package. These are addressable, but they must be verified rather than assumed from code or passing unit tests.

## Findings by priority

### P0 — Do not claim verified until tested

1. **Payment lifecycle in live/test-provider mode**
   - The code and documentation describe signed Paystack webhooks, server-to-server transaction verification, amount/currency checks, idempotency and conditional settlement.
   - Repository evidence does not prove that the deployed Paystack test/live dashboard, callback URL, webhook URL, keys, and production deployment are configured consistently.
   - Required: test-mode end-to-end tests for initialize → hosted checkout/provider response → signed webhook → order/payment settlement → duplicate webhook → invalid signature/amount/currency → buyer verification. Confirm the production configuration privately without copying secrets into GitHub or logs.

2. **Tenant/user isolation and database access controls**
   - PR #66 explicitly describes an RLS context *foundation*, not a completed rollout: it is not wired into authenticated FastAPI request flows or Prisma transactions; RLS is not enabled; protected access paths, identity provisioning, non-owner role behaviour, policies, and cross-user tests remain.
   - Do not enable RLS indiscriminately: doing so without wiring every access path can break the application. Map and test all read/write paths first, then roll out on an isolated database branch.

3. **Live purchase, seller, delivery and buyer-protection flows**
   - Automated tests are useful but do not establish that the deployed site completes a real seller listing, checkout, order state transition, delivery update, dispute, refund, and admin workflow.
   - Required: a staging smoke-test matrix using test accounts and payment-provider test mode, with no real customer data or live money.

### P1 — Required engineering hardening

4. **Continuous integration**
   - PR #63 adds a frontend quality workflow (Prisma validation, tests, TypeScript, ESLint and build), but the workflow is not present on `main` at the time of this review.
   - The proposed workflow does not run the FastAPI test suite or Ruff lint checks. Add backend checks, dependency/security review, and secret scanning before calling CI complete.

5. **Production database/migration verification**
   - The build script intentionally skips automatic production migrations unless explicitly enabled and requires `DIRECT_URL` for approved migration runs. This is a useful safeguard.
   - Still required: verify deployed migration history and schema compatibility read-only, document the approved migration procedure, and rehearse restoration from a backup on a non-production database. Never run migrations as part of this audit.

6. **Identity and authorization consistency**
   - Confirm buyer, seller, admin and super-admin role boundaries on every sensitive route and server action. Check object ownership, seller verification, CSRF/same-origin controls, rate limits, and safe error responses.
   - Review old/rollback-only auth and storage references so documentation accurately distinguishes active runtime dependencies from retained migration/rollback artefacts.

7. **Operational dependencies and observability**
   - Confirm health checks and actionable alerts for database, Redis, Cloudinary, auth and payment-provider failures. Ensure logs do not include credentials, full tokens, or unnecessary customer/payment data.
   - Verify production configuration names and URLs privately. The repository contains examples/placeholders, which are not evidence that hosted values are correct.

### P2 — Product scope and commercial transfer

8. **Campaign feature is schema-only on `main`**
   - The current Prisma schema defines `Campaign` and `CampaignProduct`, but the admin campaign page path is absent on `main` and the code search did not find a current public campaign route/service.
   - Either finish and test campaign creation/editing/deletion, product assignment, date/status transitions, public campaign pages and sitemap integration, or remove/disable campaign claims from the buyer-facing feature matrix. Do not rely on stale feature branches without rebasing and reviewing them against current `main`.

9. **Dropshipping scope disclosure**
   - The current design is seller-led and manual: supplier approval, stock/cost verification, supplier purchases and fulfilment operations are not equivalent to fully automated supplier APIs or automated purchase orders.
   - Keep manual operations documented as manual. Validate supplier costs, stock freshness, pricing/margin calculations, private supplier data exposure, order-item/fulfilment links, returns, and dispute handling.
   - Never imply that the platform holds funds in escrow unless a compliant escrow arrangement actually exists.

10. **Seller and buyer journey**
   - Run a repeatable mobile smoke test for signup/login, profile completion, seller onboarding/verification, product creation/edit/publish, image upload, search/filter, cart/checkout, order history, delivery tracking, and buyer-protection case submission.
   - Confirm failed and empty states, validation messages, accessibility basics, and that no internal supplier cost/contact/notes leak into public responses.

11. **Sale and transfer package**
    - Prepare a buyer-facing feature matrix (implemented / manual / incomplete), architecture and deployment diagram, dependency/licence inventory, security and test report, known-issues register, migration/backup runbook, domain and brand ownership evidence, and service-transfer checklist.
    - Keep all secrets, customer data, private supplier contacts, and production database exports out of the sales pack and repository.
    - Document current revenue, transaction volume, active sellers/users, operating costs and hosting dependencies truthfully. Do not imply traction that does not exist.

## Completion gates

MaliHub should be advertised as **sale-ready only after**:

- [ ] Frontend and backend CI are green on the exact candidate commit, including a Node 22 test-runner pass.
- [ ] Dependency/security and secret scans are reviewed; no unresolved critical/high finding remains without an explicitly accepted mitigation.
- [ ] Payment and order lifecycle test matrix passes in provider test mode.
- [ ] Cross-user/role isolation tests pass for both Next.js/Prisma and FastAPI/SQLAlchemy access paths.
- [ ] Staging smoke tests pass for buyer, seller, admin, dropshipping, delivery and protection flows.
- [ ] Production migration state, service health and required configuration are verified without exposing secrets.
- [ ] Backup and recovery procedure is rehearsed outside production.
- [ ] Buyer handover pack, asset ownership evidence, known limitations and operating costs are complete.

## Work order

1. Verify PR #73's patched dependency lockfile with a clean read-only audit and full frontend/backend CI run.
2. Finish the campaign feature or explicitly remove it from the marketed scope.
3. Map sensitive routes and data ownership; finish security tests before considering database RLS enforcement.
4. Run test-mode payment and order lifecycle checks.
5. Run the staging marketplace/dropshipping smoke-test matrix and fix verified defects.
6. Verify deployment/migration state and prepare the acquisition handover pack.

## Evidence and change control

This audit is a tracking baseline, not a declaration that any item has passed. Each completion claim must link to a code change or test run, and production-only checks must record the result without recording secret values. Changes are to be proposed through pull requests; no production deployment, production database mutation, or live payment change is authorised by this audit.
