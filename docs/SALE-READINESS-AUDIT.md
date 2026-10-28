# MaliHub Kenya — sale-readiness audit

**Audit date:** 2026-10-28  
**Repository:** `Manu-del-source/Malihub--kenya`  
**Scope:** source review, CI evidence, sale-critical product gaps and transfer preparation.  
**Production safety:** this audit and its companion PR do not deploy code, run migrations, change live payment configuration, or modify production secrets.

## Executive assessment

MaliHub is a substantial marketplace codebase, not merely a prototype. It has a Next.js storefront, a FastAPI service, Neon/Postgres-backed data, authentication, seller moderation, product listings, a Paystack collection path, and a manual dropshipping workflow with supplier governance. The project also has a real production domain and the operator has reported that the Paystack checkout entry flow works.

**Sale status: not yet ready to advertise as a fully proven, revenue-generating marketplace.** It may be marketed honestly as a developed marketplace platform / pre-revenue software asset once the repository and ownership package are tidy. A buyer will still need evidence of production operation and a clear list of what is manual versus automated.

## Evidence and status

### Confirmed in repository / CI
- A dedicated full-stack CI workflow now runs frontend tests, Prisma validation, TypeScript, lint, production build, FastAPI tests, Ruff and JavaScript/Python dependency audits.
- CI run `40648487092` on the isolated hardening branch passed all three jobs: frontend, backend, and JavaScript dependency audit.
- The frontend test suite, TypeScript check, lint and build passed on that run.
- Better Auth and related adapters are pinned to 1.7.7; Resend is updated to 6.35.0.
- The `npm audit --audit-level=high` gate passes, but seven low-severity advisories remain through the upstream `deepmerge` → `html-to-text` → React Email / Neon Auth UI dependency chain. Do not claim zero vulnerabilities or use `npm audit fix --force` without a reviewed compatibility plan.
- The order API requires the buyer's server-authenticated session, checks same-origin requests, rate-limits order creation, validates delivery details and requires explicit delivery-fee acceptance. Order pricing and ownership are server-derived.
- Paystack's browser popup result is not trusted as proof of payment; the documented code path requires server verification/webhook settlement.
- Dropshipping includes supplier approval, private supplier-cost records, catalogue import/approval and manual supplier-purchase/fulfilment tracking. The operational runbook explicitly says there is no automated supplier API integration and no money movement in the manual purchase confirmation route.
- The FastAPI provider layer contains explicit not-implemented capabilities: direct Safaricom Daraja/M-Pesa integration is reserved, refund execution through the generic payment-provider interface returns a not-implemented error, and the FastAPI Cloudinary storage adapter upload method is a stub that makes no Cloudinary request. Do not market these backend provider capabilities as live integrations. Confirm which upload path the deployed Next.js app actually uses before describing image uploads as production-ready.
- Campaign schema/migration exists. The campaign-management branch adds admin create/edit/delete and public active-campaign pages; the current PR must pass fresh CI and review before merge.
- The production status document records that the operator confirmed the checkout entry flow works on the canonical `www.malihubke.online` domain. This is not evidence that every webhook, refund, dispute, delivery, or payout lifecycle has been tested end to end.

### Not yet independently verified
- Fresh CI on the complete campaign-management PR (including public and admin campaign paths).
- A real, low-value production test order through payment verification, webhook delivery, duplicate-event replay, order state transitions and buyer notification. Use a controlled test plan and never invent a successful result.
- Refund/dispute behavior, delivery tracking and seller settlement/payout behavior against real provider and database state.
- Live Neon migration state and whether production schema matches the checked-in Prisma schema. Check read-only first; do not run migrations as part of an audit.
- Production error monitoring, alerting, backup/restore evidence, recovery time and restore-point objectives.
- Current active user/seller counts, transaction volume, gross merchandise value, fees, refunds, net revenue and hosting cost.
- Transfer rights and control for the domain, GitHub repository, Vercel, Render, Neon, Cloudinary, Upstash/Redis, Paystack, email and any third-party supplier assets.

## Sale-blocking / high-priority work

### P0 — release integrity and transaction safety
1. Keep the hardening/campaign work on a PR. Merge only after the latest PR checks pass and code review is complete.
2. Confirm the canonical production URL and environment values match the live deployment. The operational reference currently identifies `https://www.malihubke.online` as canonical and `https://malihub-kenya.onrender.com` as the FastAPI service; reconcile this with any older `malihub.smartbiz365.site` references before marketing.
3. Perform a controlled production smoke test of registration/login, verified seller access, product publish/search, cart, checkout, server-verified Paystack payment, order history, fulfilment status and buyer notifications.
4. Verify webhook signature validation, reference/amount/currency matching, idempotent duplicate webhook handling, and safe recovery after timeout. Do not mark an order paid from a browser redirect.
5. Verify that refunds, disputes and payouts are not represented as automatic or escrow-protected unless the actual money flow supports that claim.

### P1 — security and operational due diligence
1. Verify every sensitive API/server action rechecks the current session and role and scopes reads/writes to the correct user, seller or order.
2. The repository contains manual RLS policy scripts, but Prisma uses a privileged database connection that can bypass RLS. Treat explicit application authorization as the primary control until a dedicated non-owner role, request-scoped database identity and end-to-end cross-user tests prove otherwise. Do not claim database RLS currently protects Prisma routes.
3. Check Neon production migration history read-only, compare against the repository migration set, and document a tested backup/restore procedure before any migration.
4. Confirm secrets are absent from Git history, logs, build artifacts and public environment variables. Rotate credentials after transfer; do not send secrets to prospective buyers.
5. Review remaining low-severity JavaScript advisories and pin/patch dependencies only where a tested, compatible fix exists.
6. Reconcile legacy Supabase instructions and other stale deployment/domain references in documentation so a buyer does not follow obsolete setup steps.

### P2 — product completeness and truthful scope
1. Campaigns are merchandising collections, not discount rules. Do not advertise sale-price discounts until the discount amount is captured in checkout and immutable order snapshots and is covered by tests.
2. Direct Safaricom Daraja/M-Pesa is **not implemented** in the FastAPI provider layer; the existing storefront collection path is Paystack-based. Verify which payment channels are enabled in the live Paystack account before promising M-Pesa checkout.
3. Refund execution in the generic FastAPI provider layer is **not implemented**. Do not promise automatic refunds until an actual provider refund call, idempotency, failure recovery and tests exist.
4. The FastAPI Cloudinary upload method is **not implemented**. Trace the live Next.js upload path and test upload/permission/cleanup before claiming the backend storage adapter is production-ready.
5. Dropshipping is currently a **manual supplier operations workflow**. Do not advertise automatic supplier ordering, supplier stock synchronization, automatic tracking ingestion or supplier API integrations until implemented and tested.
6. Buyer protection must be described precisely. A shipment tracking record is not proof of escrow, safeguarded funds, automatic payouts, or guaranteed dispute resolution.
7. Finish a buyer-facing operations guide and admin runbook covering seller approval, catalogue moderation, failed payment recovery, supplier purchase failures, returns/refunds, disputes, fulfilment and incident escalation.
8. Review mobile usability, accessibility, empty/error states and production performance with actual devices and data.

## Data-room package required before listing

Prepare a private buyer data room containing:
- A product overview and short screen-recorded demo using synthetic/test data.
- Architecture diagram, stack inventory, setup guide, environment-variable **names** (not values), migration procedure and recovery runbook.
- CI evidence, dependency/security report and open issues/known limitations.
- A list of third-party services, their current plans/costs, and which accounts/domains can be transferred.
- Financial/traction sheet with source evidence. If revenue is zero, say **pre-revenue**; do not imply users, sales or profit that cannot be substantiated.
- IP and asset register: code ownership, contributor agreements, third-party licences, domain ownership, branding, designs and any AI-generated assets/code review notes.
- Proposed asset-purchase terms: what transfers, what does not, support period, liabilities, customer/personal data handling, and credential rotation.
- A scrubbed demo account and a written list of production limitations.

Never provide buyers direct access to production customer personal data, payment secrets, database credentials or private supplier cost/contact records during initial diligence. Provide aggregate or anonymised evidence first, and arrange any necessary data transfer lawfully and securely.

## Exit criteria

Do not call MaliHub “sale-ready” until:
- [ ] The campaign-management PR passes the complete current CI suite and has been reviewed.
- [ ] Production environment/domain configuration has one canonical documented source of truth.
- [ ] Read-only migration/schema comparison is complete and a backup/restore test is documented.
- [ ] Controlled end-to-end payment/webhook/order-state tests pass with evidence.
- [ ] Seller ownership isolation, admin authorization and buyer protection/refund paths have regression tests.
- [ ] No unresolved high/critical dependency advisory is known; remaining low advisories are documented.
- [ ] README, setup, deployment, operations and known-limitations docs agree with the actual stack.
- [ ] A private data room, traction/financial sheet and asset/IP register are prepared.
- [ ] The owner has verified which accounts and assets are transferable and what must be recreated by the buyer.

**Important:** CI green means the tested code passed automated checks; it does not prove production readiness, legal compliance, financial performance or the absence of all security defects.
