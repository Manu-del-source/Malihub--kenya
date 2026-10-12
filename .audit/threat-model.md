# Threat model — MaliHub Kenya payment lifecycle (Phase 10)

Scope: money movement on buyer orders via Paystack, and the surfaces that
feed it (browser, Paystack server-to-server, shared database). This model
reflects the **final code in this tree** — verify against
`.audit/findings.json` for the evidence citations.

## Trust zones

| Zone | Trust level | Holds |
| --- | --- | --- |
| Browser (checkout, order screens) | **Untrusted** | session cookie only; no payment state, no provider credentials, no secrets |
| Paystack API (authenticated, `PAYSTACK_SECRET_KEY`) | Trusted (contractual) | transaction initialize/verify responses |
| Paystack webhook delivery | **Untrusted bytes, authenticated by signature** | raw body + `x-paystack-signature` |
| Next.js server (route handlers + services) | Trusted code | the settlement logic; reads/writes Postgres |
| FastAPI backend | Trusted code, **no provider credentials** | read-only capability report; takes no payments |
| Postgres | Shared system of record | `Order`, `Payment`, `PaymentEvent`, `AuditLog` |

The invariant that everything below protects:

> **No order becomes PAID, and no payment becomes SUCCESS, unless a
> server-side conditional claim — fed by a signature-verified,
> provider-re-verified, ownership- and amount-checked event — committed it.**

## Threats, mitigations, and test evidence

### T1 — Forged webhook (attacker POSTs a "success" callback)
**Attack.** Unsigned or wrongly-signed POST to `/api/payments/paystack/webhook`.
**Mitigation.** `x-paystack-signature` must be the hex HMAC-SHA512 of the
*exact raw bytes* keyed with `PAYSTACK_SECRET_KEY` (`paystack.ts:219-228`,
constant-time compare). Unverifiable → 401, **zero writes**
(`payment-webhook-service.ts:204-210`). The key is never on the client, never
logged (redaction in both loggers), never echoed in a response.
**Tests.** `payment-webhook-service.test.ts` (wrong key, malformed, short
signature), `order-payment-lifecycle.test.ts` (forged delivery end-to-end).

### T2 — Webhook with valid signature shape but wrong content
**Attack.** Attacker who somehow knew the key (or a confused provider) sends a
success for the wrong amount/currency/reference.
**Mitigation.** After the signature gate: (a) reference must resolve to *our*
payment row — unknown references are recorded as anomalies and never settle;
(b) `Number.isSafeInteger(data.amount) && data.amount === payment.amountCents`
**and** currency equality (`payment-webhook-service.ts:355-370`);
(c) the transaction is re-verified against Paystack's authenticated API before
any claim. Every failure path writes an event, not a settlement.
**Tests.** under/over amount, wrong currency, unknown reference,
provider-says-no — all settle nothing.

### T3 — Replay / duplicate delivery
**Attack.** Paystack retries (documented: up to 72h) or an attacker replays a
captured signed delivery.
**Mitigation.** `(provider, providerEventId)` unique dedup on `payment_events`
plus a conditional status claim and terminal-state guards: the second delivery
— signed or not — is a no-op that cannot settle, notify, or mutate again.
**Tests.** duplicate + replay cases in `payment-service.test.ts` and the
lifecycle suite (settlement happens **exactly once**: 1 `payment.success`
audit + 1 order transition).

### T4 — Browser claims success ("I paid")
**Attack.** Client sends "paid" for an order and expects settlement; or a
social-engineered "mark as paid" path.
**Mitigation.** No endpoint accepts a client success claim. The buyer's screens
call `POST /api/payments/paystack/verify`, which is same-origin guarded,
rate-limited per buyer, and resolves the payment **from the session** (a body
`orderId` for another buyer 404s identically to a nonexistent one). The server
then asks **Paystack** (`GET /transaction/verify/{reference}`), re-checks
amount/currency, and only then runs the same conditional claim. The checkout
popup's `onSuccess` merely triggers that call.
**Tests.** `order-payment-lifecycle.test.ts` (browser-claim case),
`payment-verify-service.test.ts` (ownership 404-equivalence),
`checkout-client.test.ts` (client returns server snapshots only).

### T5 — Webhook/verify fork (double settlement via two channels)
**Attack.** Webhook and a concurrent verify both see an unsettled attempt.
**Mitigation.** Both channels settle through the *same* conditional claim
(`claimPaymentSuccess`) with row-level conditional update + advisory lock
inside a transaction — the claim is atomic, so exactly one channel wins and the
other observes the settled state.
**Tests.** webhook→verify and verify→webhook interleave cases, single
settlement asserted.

### T6 — Cross-tenant / cross-buyer resource access
**Attack.** Buyer A asks to verify/see buyer B's payment or order.
**Mitigation.** Every read/write is scoped by the session's user id inside the
service; ownership failures answer **identically** to nonexistent resources
(404, same body) — no existence oracle. Admin reads remain admin-gated.
**Tests.** ownership 404-equivalence in `payment-verify-service.test.ts` and
the lifecycle suite.

### T7 — Attempt abuse / provider hammering
**Attack.** Scripted buyer cycles orders/attempts to exhaust provider quotas
or create provider-side noise.
**Mitigation.** Hard in-DB attempt cap (5 per order) + in-flight join (a
concurrent initiation reuses the running attempt); per-buyer sliding-window
rate limits on initiate (10/5min) and verify (30/min); per-source limit on the
webhook (120/min) as scan-storm bound.
**Tests.** attempt-cap and in-flight-join cases in the lifecycle suite.

### T8 — Provider credential leakage
**Attack.** Client bundle, API response, log, or committed file exposes
`PAYSTACK_SECRET_KEY`.
**Mitigation.** The key is server-only (no `NEXT_PUBLIC_` prefix; the config
resolver validates `sk_test_`/`sk_live_` shape and fails closed without it);
both loggers redact by key pattern; webhook/verify responses carry no provider
detail beyond public state; the backend holds no key at all. Client-bundle
absence is asserted by the UI-contract test suite.
**Tests.** `checkout-ui-contract.test.ts` (no secrets/env in client surface);
`backend/tests/test_logging.py` (redaction).

### T9 — Settlement from a failed/abandoned/pending provider state
**Attack.** Provider reports a non-success status; a lenient mapping marks it
paid.
**Mitigation.** Only an authenticated provider answer of **success** — with
matching amount/currency — feeds the claim. Pending/failed/abandoned produce
no settlement; a provider-unreachable answer leaves the attempt awaiting
confirmation (retryable), never a fabricated status. Legacy `PAYHERO` rows
verify as `provider_retired` with zero provider calls.
**Tests.** provider-says-pending/failed cases; PAYHERO legacy case.

### T10 — Malicious uploaded content via the unsigned preset
**Attack.** Preset name is public → attacker uploads arbitrary content to the
account and stores its URL on listings/chat/avatars, served from our CDN host.
**Mitigation.** Server-side URL gates: own-cloud path check **and** `/image/`
delivery type only (ASA-FILE-001) — `/raw/` and `/video/` are refused at the
schema layer in all three write paths.
**Remaining (dashboard-dependent, unverified here).** Preset configuration
(resource types, size cap, folder, permissions) is a Cloudinary console
setting, and the `avatars` bucket's RLS policies are a Supabase project
setting — both outside this repository, documented as residuals in
`findings.json`, not claimed verified.
**Tests.** `upload-security.test.ts` (30 cases).

### T11 — Cross-user data access under the Neon deployment (no RLS backstop)
**Context.** The application database is independent PostgreSQL (Neon in
production); Neon Managed Better Auth is the identity provider. The
repository's RLS DDL — `manual_rls_policies.sql`, `manual_phase6_rls_realtime.sql`,
`manual_phase7_security.sql` — is keyed on Supabase primitives
(`auth.uid()`, `auth.jwt()`, the `storage.*` extension, the
`supabase_realtime` publication) and, per each file's own header, runs only
against a Supabase-hosted application database. It cannot be applied as-is to
the Neon database. The Supabase **avatars bucket** policies
(`manual_storage_avatars.sql`) remain applicable and relevant — the browser
uploads with the anon key and those policies are the only write gate.
**Mitigation (the design, verified in this tree).** Application-layer
authorization is the data-layer control on Neon: authentication (Neon Auth
session validity, no DB call in middleware) is separated from
authorization (authoritative Prisma read per request); role is never read from
a token; every mutation resolves ownership from the database keyed by the
session user (body fields never dictate actor/role/status); admin paths are
gated by `requireAdministratorAction`/`requireAdministrator` (51 files use the
guard set in `src/lib/auth/session.ts`). The FastAPI backend verifies Neon
Auth JWTs against the published JWKS and reads role from Postgres per request
(`AUTH_PROVIDER=neon` default; `supabase-legacy` selection fails closed when
Neon is unconfigured). Cross-user reads answer 404 identically to
non-existent ids (no enumeration oracle).
**Unverified (needs live access, not claimed).** (a) whether any adapted RLS
was applied to the production Neon database; (b) Neon project settings — DB
role privileges, network/IP restrictions, credential rotation; (c) the live
`avatars` bucket policies in the Supabase project; (d) the Realtime
configuration that live chat depends on — `postgres_changes` on
`public.messages`/`public.chats` requires Realtime to be connected to the
database that actually holds those tables, with the publication created there
(a Supabase-side/production setting; on a Supabase-hosted DB it is
`manual_phase6_rls_realtime.sql`).
**Design observation (repo-verified, production-unverified).** The chat hook
subscribes with the anon-key browser client. If the Phase 6 participant
policies were ever applied to a Supabase-hosted DB, `auth.uid()` under the
anon JWT is NULL, so `postgres_changes` row events would be silently
filtered; chat history itself is served by the authorized server path
(Prisma, participant checks), so realtime would degrade, not leak.
**Tests.** `cancel-route.test.ts` (cross-user 404, id-oracle resistance,
seller-cannot-cancel-buyer-order, body-dictation refusal),
`cart-route.test.ts`, `product-detail-route.test.ts`,
`order-transition-service.test.ts` (403/404 authorization cases).

## Out of scope / accepted risks

- **Tailwind 3.x build-toolchain advisories and next 15.5.27's moderate
  advisory** — residual, itemised under ASA-DEPS-001; fixing requires major
  upgrades (Next 16 / Tailwind 4) explicitly declined as breaking.
- **`script-src 'unsafe-inline'` in CSP** — required by Next.js App Router
  inline RSC script tags; residual, documented in `next.config.ts`.
- **CSRF `Origin` check** — fail-closed behaviour preserved unchanged
  (`src/lib/csrf.ts`); the webhook route is the only public non-session
  endpoint and is secured by the signature gate by design (documented in the
  route's header).
- **Live provider execution** — no network access to Paystack in this
  environment; signature scheme follows Paystack's published documentation,
  and all provider interactions in tests run through the injected client
  seam.
