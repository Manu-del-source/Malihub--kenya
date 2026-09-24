# MaliHub Kenya — Authentication & Account Architecture Audit (2026-09)

**Scope:** full audit + restructure of every flow that touches Supabase Auth,
the Neon Postgres mirror (`users` / `profiles` / `sellers`), the JWT
`app_metadata` claim cache, the middleware, and the error/observability layer
around all of it. This document is the audit trail: what was broken, why the
production login failed, what the new architecture guarantees, and the
evidence (tests) that pins each guarantee.

Companion doc: `ARCHITECTURE.md` §5/§5a/§5b (system-level context).

---

## 1. Executive summary

Production symptom: login fails with

> "We couldn't load your MaliHub account. Please try signing in again."

…despite an earlier fix for the `/complete-profile` redirect loop. That
message was produced by **exactly one place** in the old code — the catch-all
in `signInAction` around the post-authentication block. Anything that threw
after Supabase had authenticated the user (a Neon timeout, a Supabase Admin
rejection, a bug) was flattened into that one sentence, the session was
cleared, and **no log line identified the failing boundary**.

Root cause chain (all three were true at once):

1. **Catch-all error handling.** One `try` wrapped "provision + lookup +
   metadata update + refresh". Failure of any step → same generic message.
2. **No distinction between "the database is down" and "the database said
   no".** Prisma connection errors (P1xxx — classic on Render with Neon
   scale-to-zero) and request errors (P2xxx) looked identical to the user and
   to the logs.
3. **The service-role key path was a single point of failure with no
   diagnostics.** `app_metadata` sync goes through the Supabase Admin API with
   `SUPABASE_SERVICE_ROLE_KEY`. If that key is missing or rotated in the
   Render deployment, **every** sign-in fails at the same step with an
   "invalid JWT" 401 — indistinguishable in the UI from (2). This is the
   leading suspect for the incident (see §8, env audit).

In addition, the audit found a **redirect loop** (stale JWT claims vs. live
middleware claims), an **open redirect** in the OAuth callback, **three
divergent provisioning code paths**, a **wholesale `app_metadata` PUT** that
could clobber unrelated keys, and **role-escalation surface** in profile
completion. All are fixed and pinned by tests (§12).

**What changed, in one sentence each:**

- One provisioning boundary: `ensureApplicationAccount` — idempotent, one
  transaction, role-safe (§4.1).
- One canonical Neon read: `getApplicationAccountState` — a database failure
  is never converted into `onboarded: false` (§4.2).
- One claim mirror: `syncApplicationClaims` — read-merge-validate, minimal
  keys, fail-closed (§4.3).
- One session-refresh rule: the cookie-backed client, exactly once per flow
  (§4.4).
- One post-auth pipeline: `settleAuthenticatedAccount`, shared by password
  sign-in and the OAuth/verification callback (§4.5).
- Linear sign-in: authenticate → settle → route from **Neon truth** (§4.6).
- Profile completion: Neon transaction commits **before** any JWT update,
  destination from committed state (§4.7).
- Safe redirects everywhere via `safeInternalRedirect` (§4.8).
- Structured, redacted logs with a correlation id per operation (§10).
- 158 tests rebuilt around **behavior**, including branch-by-branch
  reproduction of the production failure (§12).

**What deliberately did NOT change:** `src/middleware.ts` code (only
comments). It is already lightweight and correct; the loop was created by
*stale claims*, which the new pipeline repairs (see §7.3). No Prisma schema
changes, no migrations, no `prisma db push` (§9). Production environment
variables were **not** touched — only audited, names only (§8).

---

## 2. Authority model (the invariant everything else enforces)

| Concern | Authority | Mechanism |
|---|---|---|
| Credential, password, email verification, Google OAuth, session lifecycle | **Supabase Auth** | Only system that stores/verifies passwords. No second auth system. |
| User *existence*, `role`, `onboarded`, profile, `Seller` state | **Neon (Postgres)** | `users` / `profiles` / `sellers` tables. The application provisions and repairs these rows. |
| `app_metadata` in the JWT (`role`, `onboarded`, `has_seller_profile`) | **Cache of Neon truth** | Mirrored via the Supabase Admin API by `syncApplicationClaims` and read by middleware at the edge. **Never** the source of a routing decision in a server flow, **never** the authorization boundary. |
| Authorization (data access) | **RLS + Server Action checks** | JWT claims are a fast path for UX redirects only. |

Consequences that are now *guaranteed by code and tests*:

- A stale or missing `app_metadata` can misroute a **first** request at most
  (middleware) — every server flow re-reads Neon and repairs the cache.
- A Neon outage can never be interpreted as "user not onboarded" and thereby
  lock someone out of an account or bounce them into onboarding.
- Client input can never choose a privileged role, and profile completion can
  never demote an existing `SELLER` or touch `ADMIN`/`SUPER_ADMIN`.

---

## 3. Flow map — 8 scenarios, before → after

Legend for "After": `settle` = `settleAuthenticatedAccount` (ensure → sync →
one refresh). **DB-failure behavior** is the column the old architecture had
no answer for — every row now has one.

| # | Scenario | BEFORE (commit 7888ba6) | AFTER | DB-failure behavior (new) |
|---|----------|-------------------------|-------|---------------------------|
| 1 | **Email sign-in — existing onboarded buyer** | `signInWithPassword` → inline provisioning/lookup → `app_metadata` update (wholesale PUT) → route from the Supabase payload/metadata | authenticate → `settle` → route from canonical Neon state → `/dashboard/buyer` | Neon down: `DATABASE_UNAVAILABLE`, one bounded retry logged as `AUTH_NEON_CONNECTION_RETRY`, **session cleared (fail closed)**, distinct message "MaliHub's account service is temporarily unavailable…" — no metadata written, no refresh, no false onboarding. Admin down: `METADATA_SYNC_FAILED`, same fail-closed, distinct message. |
| 2 | **Email sign-in — existing onboarded seller** | Same as 1, but `/dashboard/seller` only if the (possibly stale) metadata said so | `settle` reads the **Seller row** from Neon → `has_seller_profile: true` → `/dashboard/seller` | As in 1. A seller is never downgraded: role rules are applied on read, not by the payload. |
| 3 | **Email sign-in — incomplete user** | Inconsistent: destination depended on how fresh the JWT/metadata happened to be (the loop's entry point) | Deterministic: canonical state `onboarded: false` → `/complete-profile`; the cache is repaired to `onboarded: false` in the same pass (so the middleware agrees immediately) | Neon down: fail closed as in 1 — an incomplete user can *additionally* never be marked onboarded, because the only path that sets `onboarded: true` is the profile-completion transaction (§4.7). |
| 4 | **Stale or missing `app_metadata` (Neon says onboarded=true)** | The redirect loop: middleware `getUser()` returns *live* Supabase claims; JWT said `onboarded: false`; dashboard → `/complete-profile` → back → … | `settle` overwrites the cache from Neon truth (`onboarded: true`), refreshes the session **once**, routes to the dashboard. The `/complete-profile` page is also a loop-breaker: if repair fails it renders a stable error card (retry button) — it never redirects. | Neon down at the `/complete-profile` page: stable "account unavailable" card + retry — **no redirect loop possible**, because the page stops being a redirect source the moment repair is impossible. |
| 5 | **Missing Neon account rows** (new identity, or rows never provisioned because `manual_auth_trigger.sql` can't run on Neon) | `P2025` "record to update not found" on the first `update` → caught by the catch-all → generic message + sign-out | `ensureApplicationAccount` upserts the `users` + `profiles` rows and reads the `Seller` row **in one transaction** — a missing account is a normal, recoverable status (`ACCOUNT_MISSING` is a lookup status, not an error) → `/complete-profile` with correct minimal metadata | The classic P2025 failure is **impossible by construction** inside any single transaction that provisions-then-reads. If the transaction itself can't run (outage) → row 1/3 failure behavior. |
| 6 | **Neon unavailable at sign-in (P1001/P1002 — scale-to-zero)** | Generic "We couldn't load your MaliHub account…" + sign-out. Logs: one `Error: …` with no boundary. **Identical to scenario 7.** | One retry after 300 ms (bounded; never for P2xxx). Still failing → `DATABASE_UNAVAILABLE` with `boundary: "neon"`, `prismaCode: "P1001"` in the structured log; sign-out (fail closed); distinct user message. A *self-healed* cold start leaves an `AUTH_NEON_CONNECTION_RETRY` line on the same correlation id — "cold start" vs "outage" is now distinguishable in the log. | See row. |
| 7 | **Supabase Admin failure at sign-in** — service-role key missing/rotated (401 "invalid JWT"), Admin API down, or result validation tripwire | Same generic message as 6. No diagnostics: a rotated key looked exactly like a bad password to the user, and like "an error" to the logs. | `createServiceRoleClient` fails **loudly at construction** when the key is unset (`SUPABASE_SERVICE_ROLE_KEY is not configured…` — `reason: service-role-key-missing` in the log); Admin 4xx/5xx → `METADATA_SYNC_FAILED` with `boundary: "supabase-admin"` and the HTTP status in the log. Read-merge **fails closed on read failure** (no blind 3-key PUT that could clobber unrelated keys). The Admin result is validated (user id must match) before use. Sign-out; distinct user message. | See row. **This is the leading production suspect** — verify `SUPABASE_SERVICE_ROLE_KEY` in Render (§13). |
| 8 | **OAuth (Google) / email-confirmation callback** — new user, existing seller, or password-reset link | `exchangeCodeForSession` → inline (third) provisioning path → metadata write → `redirect(`${origin}${next}`)` — **open redirect** (`next` is user-influenced) and divergent from scenario 1 | `exchangeCodeForSession` → the **same** `settle` pipeline as password sign-in → `safeInternalRedirect(next)` (hostile targets rejected, logged, safely ignored) → else canonical-state destination (`/complete-profile` new, `/dashboard/seller` existing seller). | Exchange failure (expired/used code): → `/login?error=…`, nothing provisioned. **Settle failure (Neon/Admin down): the session is KEPT** (the code exchange established it) and the user is routed to `/complete-profile`, which self-heals — no forced re-login, no crash, no loop. |

Supporting flows (not in the 8, same guarantees):

- **Profile completion** — §4.7; DB failure → controlled message, nothing
  committed, no refresh (the user keeps their form state and can retry).
- **Sign-out** — unchanged semantics; now also the *explicit* fail-closed
  step after a settlement failure (sign-in) — and deliberately **not** done
  after a callback settle failure (row 8).
- **Password reset** — unchanged; the callback route (row 8) owns the
  recovery-session landing.
- **Middleware** — unchanged code; see §7.3 for why it needed no change.

---

## 4. The single boundaries (one implementation each)

All in `src/services/` — `auth-service.ts` (server-only wiring: Prisma +
Supabase), `account-provisioning.ts` (pure logic, store-injected),
`auth-errors.ts` (classification), `auth-logging.ts` (structured logs).

### 4.1 `ensureApplicationAccount` — the only provisioning boundary

- One `prisma.$transaction`: `users.upsert` → `profiles.upsert` →
  `sellers.findUnique`. Reads and writes share the transaction, so the
  returned state is **committed truth**, not a guess.
- Idempotent: re-running it for an existing identity is a no-op that returns
  the same canonical state (tests pin the exact statement plan).
- No role escalation: `create` defaults to `BUYER`; existing roles are never
  rewritten by this function (`decideProfileRole` is the only role writer,
  and it never raises privileges and never demotes `SELLER`).
- **Role-safety addition found during the audit:** profile completion used to
  create a starter `Seller` row for *anyone* who ticked "sell" — including an
  `ADMIN`/`SUPER_ADMIN` re-running onboarding. Access grants now stay out of
  the form's reach: the Seller row is created only when the **resulting**
  role is `SELLER` (pinned by tests).
- Identity without an email (possible via OAuth edge cases) → controlled
  `AuthServiceError` ("no email on file — contact support"), never a raw
  constraint error.

### 4.2 `getApplicationAccountState` — the canonical Neon lookup

Returns `{ userId, exists, role, onboarded, hasSellerProfile, profile }`:

- `exists: false` (`ACCOUNT_MISSING`) is a **status, not an error** —
  provisioning handles it.
- Any database failure is an error (`DATABASE_UNAVAILABLE` for P1xxx,
  `ACCOUNT_LOOKUP_FAILED` for other reads), **never** converted into
  `onboarded: false`. The "database failure ≠ missing account" rule from the
  audit brief is enforced by construction and pinned by tests.

### 4.3 `syncApplicationClaims` — the only writer of `app_metadata`

- **Minimal keys**: exactly `{ role, onboarded, has_seller_profile }`.
- **Read-merge-write**: reads the current `app_metadata` via Admin
  `getUserById`, merges the three keys, writes the merged object. Unrelated
  keys (e.g. anything a future flow adds) are preserved — the old wholesale
  PUT could clobber them, because the Supabase Admin `updateUserById`
  replaces the `app_metadata` object entirely.
- **Fail-closed on read failure**: if the read fails we do **not** guess and
  write three keys (that *is* the clobber). The sync throws
  `METADATA_SYNC_FAILED` and the caller fails closed.
- **Result validation**: after the write, the Admin API's returned user is
  checked (same id, expected `app_metadata`); a mismatch is a
  `METADATA_SYNC_FAILED`, not silent success.
- Privileged roles are mirrored as-is (`ADMIN`/`SUPER_ADMIN`), never
  rewritten.

### 4.4 Session refresh — one rule

- Only the **cookie-backed** per-request client may call `refreshSession()`.
  The service-role client has no cookie adapter at all, so it *cannot* be
  confused with the user's session.
- **Exactly once per flow** (pinned by call-count tests on the sign-in,
  callback, and profile-completion paths).
- **Failure semantics:** refresh failure is **non-fatal** at sign-in and
  profile completion (the middleware re-reads *live* Supabase claims on the
  next request, so a slightly-stale cookie self-corrects; failing the user
  out for a cookie-write hiccup is the loop factory). It is still
  classified and logged (`SESSION_REFRESH_FAILED`), never swallowed.
  Settlement failures (Neon/Admin) are the opposite: **fatal**, fail-closed.

### 4.5 `settleAuthenticatedAccount` — the shared post-auth pipeline

```
ensureApplicationAccount (Neon, one txn, one bounded retry on P1xxx)
  → syncApplicationClaims (Supabase Admin: read-merge-validate)
  → refreshUserSession (cookie client, exactly once)
  → returns the canonical ApplicationAccountState
```

Password sign-in and the OAuth/verification callback are the only two
callers. There is no third provisioning path: sign-up is **best-effort**
(`provisionUserRows` — classified + logged, never fatal), because the
authoritative re-run happens at the next sign-in/callback/profile-completion,
all idempotent.

### 4.6 Sign-in — a straight line

```
validate → signInWithPassword
  → error? classify → safe copy, done (no Neon work, no sign-out: no session)
  → settle
      → success? route from Neon state:
          onboarded ? (safeInternalRedirect(redirectTo) ?? dashboardFor(state))
                    : /complete-profile
      → failure? classify → signOut (fail closed) → distinct safe copy
```

Routing decisions come **only** from the canonical Neon state — never from
the pre-refresh Supabase payload or stale `app_metadata`. The `redirectTo`
param is user-influenced and only honored through `safeInternalRedirect`.

### 4.7 Profile completion — the loop breaker

```
validate → getUser (no session → "session expired", zero DB work)
  → completeUserProfile:
       ONE transaction: provision rows (if missing) → phone pre-check
       (P2002 race) → decideProfileRole → user.update(phone, role)
       → profile.update(onboarded: true, …) → Seller row (resulting-role rule)
       → returns committed state
       → best-effort syncApplicationClaims (failure logged, non-fatal:
         the transaction already committed; middleware will self-heal)
  → refreshUserSession (exactly once)
  → route from the COMMITTED state (dashboardFor)
```

**The Neon transaction commits before any JWT/session update.** The
destination never reads the request payload's intent — an existing `SELLER`
who re-runs onboarding as "BUYER" still lands on `/dashboard/seller`.

### 4.8 Redirect safety — `src/lib/redirect-safety.ts`

`safeInternalRedirect(value)` accepts only same-origin internal paths:
starts with a single `/`, no second `/` or `\` after it (kills `//evil`,
`\\evil`), no scheme (`https://`, `javascript:`, `data:`), no control
characters **or their percent-encoded forms** (`%00`–`%1F`, `%7F` — log/header
poisoning), length-capped, and the result is re-parsed through `URL` to
verify the origin round-trip. Returns `null` (caller falls back to a
safe destination and logs `INVALID_REDIRECT`) instead of throwing. Wired into
`signInAction` and the callback route — the old callback's
`` `${origin}${next}` `` open redirect is gone.

---

## 5. The production error, branch by branch

**Exact old code** (`src/app/(auth)/actions.ts` at 7888ba6):

```ts
try {
  // …provisioning + lookup + app_metadata update + refresh…
  return { success: true, data: { redirectTo } };
} catch (error) {
  await supabase.auth.signOut();
  return { success: false, error: "We couldn't load your MaliHub account. Please try signing in again." };
}
```

Any throw in the block → sign-out + that sentence. There was no
classification, and the log line (an unstructured `console.error` of the raw
error) was the only trace — and in the Admin-key case it read as a
cryptic "invalid JWT" with no indication that *supabase-admin* was the
boundary.

**New behavior — the same production repro, now four distinct branches**
(each pinned by a test in
`src/app/(auth)/__tests__/sign-in-action.test.ts` → "the production failure,
reproduced branch by branch"):

| Branch | Trigger | Code (log) | User sees | Fail-closed action |
|---|---|---|---|---|
| A | Neon P1001 (both attempts) | `DATABASE_UNAVAILABLE`, `boundary: neon`, `prismaCode: P1001` | "MaliHub's account service is temporarily unavailable. Please try again in a minute." | sign-out; no Admin call; no refresh; no metadata written |
| B | Admin 401 (rotated/missing key) | `METADATA_SYNC_FAILED`, `boundary: supabase-admin`, `httpStatus: 401` | "We couldn't fully load your MaliHub account. Please try signing in again in a moment." | sign-out; no refresh |
| C | `SUPABASE_SERVICE_ROLE_KEY` unset | `METADATA_SYNC_FAILED`, `reason: service-role-key-missing` (thrown at client construction — the leading incident suspect) | same as B | sign-out; **no Admin call even attempted** |
| D | Neon P2xxx (e.g. P2022 schema drift) | `ACCOUNT_PROVISIONING_FAILED` with `prismaCode` — *not* retried (the DB answered) | "We couldn't prepare your MaliHub account. Please try signing in again in a moment." | sign-out |

Note the old sentence "We couldn't load your MaliHub account…" survives as
the copy for `ACCOUNT_LOOKUP_FAILED` — the *lookup* boundary of the
`/complete-profile` page — so legacy users still recognize their error, now
bound to one specific class with server-side diagnostics. Distinctness of
the three main messages (DB vs Admin vs bad-credentials) is itself pinned by
a test, so a future refactor cannot re-collapse them.

---

## 6. Error model (one failure = one classification)

`src/services/auth-errors.ts` — pure module, the **only** place raw errors
are interpreted; callers never re-inspect a raw error.

| Code | Boundary | Trigger | User-facing copy |
|---|---|---|---|
| `AUTHENTICATION_FAILED` (reason: `invalid-credentials`) | supabase-auth | Supabase 4xx rejection (400/401/403/404 — collapsed to prevent account enumeration) | "That email or password doesn't look right." |
| `AUTHENTICATION_FAILED` (reason: `email-not-confirmed`) | supabase-auth | GoTrue "Email not confirmed" | "Please verify your email before signing in — check your inbox." |
| `AUTHENTICATION_FAILED` (reason: `rate-limited`) | supabase-auth | HTTP 429 | "Too many attempts. Please wait a moment and try again." |
| `AUTHENTICATION_FAILED` (reason: `service-unavailable`) | supabase-auth | No HTTP status (network) or 5xx | "Sign-in is temporarily unavailable. Please try again in a minute." |
| `DATABASE_UNAVAILABLE` | neon | Prisma P1xxx (timeout, unreachable, closed) | "MaliHub's account service is temporarily unavailable. Please try again in a minute." |
| `ACCOUNT_PROVISIONING_FAILED` | neon | Prisma P2xxx during provisioning (P2002 race → special "already linked" copy) | "We couldn't prepare your MaliHub account. Please try signing in again in a moment." |
| `ACCOUNT_LOOKUP_FAILED` | neon | Non-P1 read failure (the legacy production sentence, now scoped to this class) | "We couldn't load your MaliHub account. Please try signing in again." |
| `METADATA_SYNC_FAILED` | supabase-admin | Admin read/write failure, validation mismatch, missing service-role key | "We couldn't fully load your MaliHub account. Please try signing in again in a moment." |
| `SESSION_REFRESH_FAILED` | session | `refreshSession()` error/throw — **non-fatal**, logged | "Your session couldn't be refreshed. Please sign in again." |
| `INVALID_REDIRECT` | (internal) | Hostile `next`/`redirectTo` — never surfaced; fallback used + logged | — |
| `INTERNAL_ERROR` | unknown | Anything unmatched | "Something went wrong. Please try again, and contact support if it persists." |

`ACCOUNT_MISSING` is deliberately **not** an error — it's a lookup status
(provisioning creates the rows). Rule: **user copy is safe and distinct per
class; machine diagnosis (code, boundary, prismaCode/httpStatus/sdkName)
lives in the log, never in the UI.** No infrastructure names ("Neon",
"Prisma", "Supabase Admin") appear in user-facing strings.

---

## 7. Security review

**Rule honored throughout: nothing was weakened to make login work.**

1. **Session fixation / stale cookies.** The pre-refresh Supabase payload and
   the cookie's JWT claims are never used for routing decisions in server
   flows. The session is refreshed exactly once, after committed state is
   known. On settlement failure at sign-in the session is *destroyed* (fail
   closed) — a session with unverified claims is never carried forward.
2. **Stale `app_metadata` claims.** Repaired on every authenticated touch
   point (sign-in, callback, profile completion) from Neon truth; the
   read-merge preserves unrelated keys and the write result is validated.
   Middleware's live `getUser()` read (verified against the installed
   `@supabase/ssr` 0.5.2 + supabase-js 2.47.10: `getUser()` always round-
   trips to GoTrue) means the edge sees the *current* claim cache — that's
   why repairing the cache also breaks the loop.
3. **Privilege escalation.** Roles are only ever written by
   `decideProfileRole`: `ADMIN`/`SUPER_ADMIN` pass through untouched;
   `SELLER` is sticky (never demoted); `BUYER → SELLER` only when the user
   opts in — and now only the resulting-`SELLER` gets a Seller row (an admin
   can't self-grant seller state via the onboarding form). Client input
   cannot name a role: the schema accepts `accountIntent ∈ {BUYER, SELLER,
   BOTH}` and maps it through the same rules. JWT mirroring cannot raise a
   role: it mirrors the Neon value, which is role-safe by the same function.
4. **Open redirect.** Fixed (§4.8) in both places the target is
   user-influenced (`signInAction(redirectTo)`, callback `next`). Rejected
   targets are logged (`INVALID_REDIRECT`) and replaced by the canonical
   destination — the middleware remains the final authority.
5. **Service-role exposure.** `src/lib/supabase/server.ts` now
   `import "server-only"` — the bundler **rejects** any client-bundle import
   of the module that holds `SUPABASE_SERVICE_ROLE_KEY`. The service-role
   client is created with no cookie adapter (it cannot touch the user's
   session) and fails loudly at construction if the key is unset. The
   backend already refuses a service-role JWT presented as a user token (403)
   — unchanged.
6. **Account enumeration.** All credential-side 4xx collapse to one
   "doesn't look right" copy; the forgot-password flow keeps its
   always-successful response.
7. **CSRF.** Unchanged posture: Server Actions rely on Next's
   `next-action` header + same-origin form/`fetch` semantics; no new
   state-changing endpoints were added (the callback route is GET, as
   Supabase requires, and only establishes/repairs state — it writes no
   arbitrary data). Redirect params are validated, so no stored-redirect
   CSRF via `next`.
8. **Log injection / leakage.** Structured logger writes only whitelisted
   primitive fields; `safeFields` drops any key matching
   `token|password|secret|cookie|authorization|apikey|jwt|session|database|…`
   and any non-primitive value. Correlation ids are random UUIDs. No
   passwords, tokens, cookies, keys, or `DATABASE_URL` fragments can reach
   the log even if a caller passes a whole error object.
9. **Bypass surface.** The `/api/*` and `/dashboard/messages/*` self-auth
   exemptions are unchanged. Middleware code is byte-identical (comments
   only) — audited for that reason; it performs zero data access (pinned by
   a source-scan test), so it can't be a data-leak or DoS vector per request.

---

## 8. Environment audit (names only — no values, nothing modified)

Status legend: **REQUIRED** (app is broken without it) · **OPTIONAL**
(degrades gracefully) · **UNUSED** (declared, not read) · **SERVER-ONLY**
(never in client bundles) · **CLIENT-SAFE** (safe to expose via
`NEXT_PUBLIC_*`).

| Variable | Scope | Status | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | both | REQUIRED · CLIENT-SAFE | Supabase project URL; read by client + server Supabase factories. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | both | REQUIRED · CLIENT-SAFE (by design) | Public API key; security rests on RLS + the fact that application data lives in Neon, not Supabase Postgres. |
| `SUPABASE_SERVICE_ROLE_KEY` | server | **REQUIRED** · SERVER-ONLY | The leading incident suspect. Missing/rotated → every sign-in fails at `METADATA_SYNC_FAILED` (`reason: service-role-key-missing` now makes this instant to diagnose in logs). Enforced server-only via `import "server-only"`. |
| `DATABASE_URL` | server | REQUIRED · SERVER-ONLY | Read by the Prisma client (schema `env("DATABASE_URL")`), never by app code; never reaches the client bundle (Prisma client is server-only). |
| `DIRECT_URL` | server (tooling) | OPTIONAL at runtime · SERVER-ONLY | Non-pooled URL for `prisma migrate` only; the schema maps it to `directUrl`. |
| `SUPABASE_JWT_SECRET` | backend | OPTIONAL for Next.js · SERVER-ONLY | Read by the FastAPI backend to verify Supabase JWTs (HS256 mode); not read by the Next.js app. |
| `NEXT_PUBLIC_APP_URL` | both | REQUIRED · CLIENT-SAFE | Origin for OAuth/verification redirect URLs (`/api/auth/callback?next=…`). |
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | both | REQUIRED (uploads) · CLIENT-SAFE | Cloud name for unsigned uploads. |
| `NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET` | both | REQUIRED (uploads) · CLIENT-SAFE | Unsigned preset; the app uses preset uploads, so no server Cloudinary secret is needed by Next.js. |
| `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | server | **UNUSED by the Next.js app** | Declared; not read anywhere in `src/`. Keep only if an external tooling path uses them; otherwise candidates for removal in a later cleanup (not done here — env files untouched per instructions). |
| `RESEND_API_KEY` | server | OPTIONAL · SERVER-ONLY | `email-service` returns a null client when unset — mail is skipped, auth never depends on it. |
| `EMAIL_FROM` | server | OPTIONAL · SERVER-ONLY | Default from-address; has a built-in fallback. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | server | OPTIONAL · SERVER-ONLY | `src/lib/redis.ts` (rate limiting/caching); not on the auth path. |
| `NEXTAUTH_SECRET` / `JWT_SECRET` | — | **UNUSED** | No NextAuth in this app (Supabase Auth is the only auth system). Legacy declarations in `.env.example` — flagged for future removal; leaving the file untouched per the "report, don't modify env" instruction. |
| `NEXT_PUBLIC_APP_NAME` | — | **UNUSED** | Declared, not read in `src/`. |
| `NEXT_PUBLIC_API_BASE_URL` | — | **UNUSED by current client code** | The FastAPI backend is consumed by its own service; no Next.js client fetch uses this base URL today. |
| `PAYHERO_*` (all) | backend | out of scope for Next.js | Read by the FastAPI backend only; auth-unrelated. |

**Verification procedure (safe, no secrets printed):** in the Render
dashboard, confirm `SUPABASE_SERVICE_ROLE_KEY` exists and matches the
*current* key in the Supabase dashboard → Settings → API (rotate-check by
comparing key lengths/prefixes only if needed — do not paste values into
chat/logs). After the next deploy, a single sign-in attempt produces
`AUTH_START → …` structured lines; a missing key now shows as
`METADATA_SYNC_FAILED … note:"SUPABASE_SERVICE_ROLE_KEY is not configured…"`
immediately.

---

## 9. Prisma / schema audit

Models in scope (`prisma/schema.prisma`):

- **User** (`users`): `id String @id @db.Uuid` — deliberately the **Supabase
  UUID** (the app assigns it; the DB generates nothing). `email String
  @unique` (non-nullable), `phone String? @unique`, `role UserRole
  @default(BUYER)`, `emailVerified`, `isActive`, `isBanned`, `lastSeenAt`,
  timestamps. Relations: optional 1:1 `Profile`, optional 1:1 `Seller`, plus
  marketplace collections.
- **Profile** (`profiles`): own `id` PK; `userId @unique @db.Uuid` → 1:1 with
  User, `onDelete: Cascade`; `fullName` non-nullable; `onboarded Boolean
  @default(false)` — the onboarding flag the whole pipeline reads/writes.
- **Seller** (`sellers`): own `id` PK; `userId @unique @db.Uuid` → 1:1;
  `slug @unique`; verification status defaults to `UNVERIFIED`.

**Findings:**

1. **No schema defect affecting auth.** The 1:1 uniqueness on
   `profiles.userId` / `sellers.userId` matches the "one profile, one seller
   row per user" invariant; `users.email @unique` + `users.phone @unique`
   back the P2002 race handling (pre-check + classifier backstop).
2. **The historical P2025 bug was a *transaction-shape* defect, not a schema
   defect**: the old code `update`d `profiles` rows that didn't exist yet
   (rows were supposed to come from `manual_auth_trigger.sql`, which cannot
   run on Neon — it targets Supabase Postgres' `auth.users`). The new
   provisioning upserts within the same transaction, so P2025 on this path
   is structurally impossible. **No migration needed; none created;
   `prisma db push` was not run** (per instruction).
3. `User.email` non-nullable: OAuth identities without an email are rejected
   at provisioning with a controlled "contact support" message rather than a
   constraint error — a schema constraint the app now handles explicitly.
4. The `manual_*.sql` files (RLS, storage, auth trigger) are unchanged. RLS
   remains the data-access backstop per §2; `manual_auth_trigger.sql` remains
   an optional extra for Supabase-Postgres deployments only.

---

## 10. Observability (structured logs with correlation id)

`src/services/auth-logging.ts` — one `AuthLog` context per operation, one
`correlationId` (random UUID) per context, JSON lines to stdout (Render/Node
shippers and `jq` parse directly). Redaction is §7.8.

Event vocabulary (abridged — full list in `AUTH_EVENTS`):
`AUTH_START`, `AUTH_SUPABASE_SUCCESS`, `AUTH_ACCOUNT_PROVISION_START/
SUCCESS`, `AUTH_ACCOUNT_LOOKUP_START/SUCCESS`, `AUTH_NEON_CONNECTION_RETRY`
(NEW: cold start self-healed), `AUTH_METADATA_SYNC_START/SUCCESS`,
`AUTH_SESSION_REFRESH_START/SUCCESS`, `AUTH_PROFILE_COMPLETED`,
`AUTH_REDIRECT`, `AUTH_FAILURE`.

`AUTH_FAILURE` lines always carry: `code` (taxonomy), `boundary`
(`supabase-auth | neon | supabase-admin | session | unknown`), and the raw
diagnostics — `errorType` (e.g. `PrismaClientInitializationError`),
`errorCode`/`prismaCode` (e.g. `P1001`), `httpStatus` (e.g. `401`),
`sdkName`, `note` (already-safe string such as
`operation=updateUserById invalid JWT`), plus `userId` and the
`correlationId` that ties every line of the flow together.

**Diagnosing the production incident after deploy (copy-paste):**

```bash
# which boundary is failing, right now:
… | jq -r 'select(.event=="AUTH_FAILURE") | [.code, .boundary, .errorCode, .prismaCode, .httpStatus] | @tsv'

# was a Neon cold start involved (scale-to-zero)?:
… | jq -r 'select(.event=="AUTH_NEON_CONNECTION_RETRY") | [.correlationId, .prismaCode] | @tsv'

# follow one failing login end-to-end:
… | jq -r 'select(.correlationId=="<id from a failing UI attempt>")'
```

Quiet in the test suite unless `AUTH_DEBUG=1` (one test pins the redacted
retry line end-to-end).

---

## 11. Performance (no duplicate work)

Per-flow boundary crossings, **after** (pinned by ordered-timeline tests):

| Flow | Neon (Prisma units) | Supabase Admin | Session refresh |
|---|---|---|---|
| Sign-in (happy path) | **1 transaction** (`user.upsert`, `profile.upsert`, `seller.findUnique`) — with at most one retry on P1xxx | 1 read + 1 write (read-merge) | **1** |
| OAuth/verify callback | same as sign-in | 1 read + 1 write | **1** |
| Profile completion | **1 transaction** (provision-if-missing + writes + seller read) | 1 read + 1 write (best-effort) | **1** |
| Middleware (every request) | **0** | 1 live `getUser()` round-trip (existing behavior, unchanged) | cookie refresh only |

vs. before: duplicated provisioning across three call sites (sign-in action,
callback route, complete-profile page), a separate follow-up read after the
provisioning write, and unbounded/absent retry semantics. No flow makes more
than one Neon unit and one Admin pair; the only per-request data access is
the middleware's session round-trip, which predates this change and is the
standard `@supabase/ssr` pattern.

---

## 12. Test strategy — rebuilt around behavior (158 tests, all passing)

Old suite: 32 tests asserting implementation details (helper internals,
mocked happy paths) — green while production was broken, because they never
exercised the failure branches. New suite: **158 tests**, organized as:

| File | Pins |
|---|---|
| `src/services/__tests__/auth-errors.test.ts` | The full taxonomy: every raw shape (P1xxx/P2xxx, 429, 5xx, network, "Email not confirmed", 400) maps to exactly one code + the right copy; `userMessage` override; distinctness of the main production messages. |
| `src/services/__tests__/account-provisioning.test.ts` | Pure provisioning: exact statement plan, idempotency, P2025 first-onboard regression, phone-conflict rollback, the **role rules** (ADMIN/SUPER_ADMIN untouched, SELLER sticky, no admin seller-row grant, seller row never deleted), identity-without-email. |
| `src/lib/__tests__/redirect-safety.test.ts` | Every hostile vector rejected (`//evil`, `\\evil`, `https://`, `javascript:`, `data:`, raw + percent-encoded C0 controls, overlong), legit internal paths with query+hash accepted. |
| `src/services/__tests__/auth-service.test.ts` | The wired boundaries: read-merge preserves unrelated keys; read failure fails closed; result validation; P1001 **one** retry then `DATABASE_UNAVAILABLE`; P2002 → provisioning code; P1xxx retry emits the correlated `AUTH_NEON_CONNECTION_RETRY` line; settle ordering (`neon ensure → admin get → admin update → one refresh`) via an interleaved timeline; Neon-down ⇒ no Admin, no refresh; refresh failure non-fatal; `provisionUserRows` best-effort. |
| `src/app/(auth)/__tests__/sign-in-action.test.ts` | The full sign-in matrix (spec scenarios 1–13 + extras) and **the production failure reproduced branch by branch** (Neon-down vs Admin-down vs missing-key vs P2xxx ⇒ distinct code + distinct copy + sign-out + no metadata/refresh), invalid-redirect fallback, exactly-one-refresh ordering. |
| `src/app/(auth)/__tests__/complete-profile-action.test.ts` | The committed-state contract: tx commits before metadata/refresh (pinned by timeline), seller no-downgrade → `/dashboard/seller`, ADMIN/SUPER_ADMIN preserved, sync failure non-fatal, Neon failure controlled (nothing committed, no refresh), no-session and invalid-input do zero work. |
| `src/app/api/auth/callback/__tests__/callback-route.test.ts` | New-user → `/complete-profile`; existing seller → `/dashboard/seller`; safe `next` honored; **hostile `next` ignored**; missing/expired code → controlled `/login` errors; settle failure → **session kept** → self-healing `/complete-profile`. |
| `src/__tests__/middleware.test.ts` | Full decision matrix (unauth, incomplete, buyer, seller, admin, super-admin, stale claims, onboarding exemptions, `/api` passthrough, auth-route bounce) + source-scan proving the middleware touches no data layer. |

Shared fakes (`src/services/__tests__/helpers/`) simulate the *process
boundaries* — an in-memory Prisma (with `$transaction` snapshot/rollback,
unique-index enforcement, P-code errors) and a Supabase world (session +
Admin clients sharing one user store, so an Admin write is visible to a later
`getUser()`, exactly like the real thing; wholesale `app_metadata` PUT
semantics). No network, no credentials, no production database — and the
fakes deliberately reproduce the two semantics that caused real bugs:
Admin-PUT replaces `app_metadata` wholesale, and P1xxx vs P2xxx error
classes.

**Run:** `npm test` (Node's test runner via tsx +
`--experimental-test-module-mocks`).

---

## 13. Residual risks & production checklist

1. **Verify `SUPABASE_SERVICE_ROLE_KEY` on Render** (the leading suspect).
   Post-deploy, any sign-in now logs its boundary; a missing key is
   immediately visible (§10).
2. **Neon scale-to-zero**: the bounded 300 ms retry absorbs the common cold
   start and logs `AUTH_NEON_CONNECTION_RETRY`. If that line appears
   frequently with long delays, consider a Neon always-on tier or a
   connection warm-keep — a deploy-config decision, not a code one.
3. **`app_metadata` is still a cache**: middleware decisions between two
   repairs can be one step stale by design (that's the fast path). Server
   flows and RLS never trust it. If a future flow needs a stronger edge
   guarantee, that's a middleware change — deliberately out of scope here.
4. **`manual_auth_trigger.sql`** remains a dead path on Neon (documented as
   such in §5/§9). No action needed; do not schedule it.
5. **Legacy env names** (`NEXTAUTH_SECRET`, `JWT_SECRET`,
   `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_API_BASE_URL`, Cloudinary API
   keys/secret in the Next.js app) are declared-but-unused — flagged in §8
   for a future cleanup pass; env files intentionally untouched.
6. **tsc note for this workspace:** `npx prisma generate` cannot run in this
   sandbox (engine download blocked), so `tsc --noEmit` reports the
   pre-existing "generated client types missing" errors here and only here.
   CI runs `prisma generate` before type-check/build; the test suite
   (158/158 green) is the executable verification in this environment.

---

*Audit date: 2026-09-24. Code state: branch `arena/01a0d251-malihub-kenya`.
All behavior claims above are pinned by the test suite in §12.*
