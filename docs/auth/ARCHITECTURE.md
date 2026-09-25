# MaliHub Kenya — Authentication Architecture

**Provider:** Neon Managed Better Auth (`@neondatabase/auth@0.5.0-beta`)
**Status:** primary and only authentication path
**Companion document:** [`MIGRATION.md`](./MIGRATION.md) — cutover, legacy users, rollback

This document describes how authentication and authorization work *now*. For what
changed and how to operate the cutover, read `MIGRATION.md`. For the rest of the
system, see the repository-root [`ARCHITECTURE.md`](../../ARCHITECTURE.md) §5.

---

## 1. The two questions, and who answers them

Every auth decision in MaliHub is one of two questions, and the migration's core
change is that they are now answered by different layers that never overlap:

| Question | Answered by | Reads | Cost |
|---|---|---|---|
| **Is there a valid session?** (authentication) | `src/middleware.ts` | the signed session cookie, validated locally | no network, no database |
| **What may this account do?** (authorization) | guards in `src/lib/auth/session.ts` | MaliHub's Postgres rows | one indexed query per request, deduplicated |

Previously both were answered in middleware, from the provider's `app_metadata`
JWT claims. That is the single most consequential thing this migration removes.

### Why the claim cache had to go

`app_metadata` was a *cache* of `users.role`, `profiles.onboarded` and the
existence of a `sellers` row, stored inside a token the application could not
write to without an admin API call and a session refresh. Three consequences, all
of which MaliHub hit in production:

1. **It goes stale.** The token in the browser keeps the claims it was minted
   with. Writing new claims server-side does not update it — you must re-mint via
   `refreshSession()` and hope the response's rotated cookies reach the browser.
2. **Staleness produces redirect loops.** Middleware reading `onboarded: false`
   from a token that predated a committed profile write bounced the user from
   `/dashboard/*` back to `/complete-profile`, which saw the profile as complete
   and bounced them to the dashboard. This repository fixed that loop twice.
3. **It cannot be reproduced on Neon Auth.** Managed Better Auth accepts no
   custom Better Auth plugins and exposes no arbitrary claims, so there is nowhere
   to put a role. The constraint turned out to be a gift: it removed the failure
   mode rather than requiring us to manage it.

There is no claim cache now. A role change takes effect on the next request, with
nothing to invalidate and no session to re-mint.

---

## 2. Module map

```
src/lib/auth/
├── index.ts      Public barrel — the ONLY auth import application code should use
├── config.ts     Env resolution, route ownership, verifier handling   (edge-safe)
├── redirects.ts  safeInternalRedirect(), loginUrlWithRedirect()       (edge-safe)
├── errors.ts     Provider errors → MaliHub's AuthFailure contract     (edge-safe)
├── neon.ts       THE ONLY module importing @neondatabase/auth         (edge-safe)
├── types.ts      AuthIdentity, ApplicationAccess, AuthFailureCode     (edge-safe)
├── identity.ts   Provider session → application user (Prisma)         (server-only)
└── session.ts    Guards: requireUser(), requireSellerAccess(), …      (server-only)

src/services/
├── account-provisioning.ts  Provider-agnostic row provisioning + authoritative reads
└── auth-service.ts          Orchestration used by the Server Actions
```

The split is not cosmetic:

- **Edge-safe modules** import no Prisma and no `server-only`. Middleware may
  import them. `index.ts` re-exports the server-only modules too, so **middleware
  must never import the barrel** — it imports `config`, `redirects` and `neon`
  directly. That rule is why the edge bundle is 75 kB rather than carrying Prisma.
- **`neon.ts` is the entire provider surface.** Swapping or rolling back the
  provider is a change to `neon.ts` plus `config.ts`, not a sweep across the ~25
  pages, layouts, actions and route handlers that need to know who is signed in.

---

## 3. Identity model: two ids, mapped deliberately

```
Neon Auth identity                      MaliHub application
──────────────────                      ───────────────────
neon_auth.user.id  ───maps to───▶  users.auth_user_id  (TEXT, UNIQUE, nullable)
                                   users.id            (UUID, MaliHub-generated)
                                        ▲
                                        └── target of EVERY foreign key in the schema
```

`users.id` is **not** the provider's id, and never was in this design. Two
reasons:

1. **Portability.** Every foreign key in the schema — products, orders, messages,
   notifications, wishlist, sellers — targets `users.id`. If that column held a
   provider-issued value, changing provider would mean rewriting the entire
   database. As it stands, a provider change is a backfill of one nullable column.
2. **Opacity.** The provider's id format is not MaliHub's business. It is stored
   as `TEXT`, matched by equality, and never parsed, formatted, validated as a
   UUID, or shown to a user.

The mapping is resolved in one direction only: MaliHub asks "which of my users is
this auth identity?", via the UNIQUE `auth_user_id` index. MaliHub never asks the
auth service to look anything up by application id, and the auth service never
learns what a MaliHub application id is.

### Read half vs write half

`account-provisioning.ts` separates them, and the distinction matters for
performance:

- **`findMappedApplicationUserId()`** — read-only lookup. Used by every guard.
- **`resolveApplicationUserId()`** — creates or claims a row. Used only where an
  identity is *established*: sign-up, sign-in, and the `/complete-profile`
  transaction.

Guards run on essentially every request, including public marketing pages that
only want to render a signed-in header. A guard that provisioned would put two
writes on the hottest path in the application to answer a question whose usual
answer is "no rows yet".

---

## 4. Provisioning and the email-collision rule

`users.email` is UNIQUE, so a brand-new auth identity whose email already belongs
to an application row cannot simply be inserted. Two cases, handled differently on
purpose:

1. **The row is unmapped (`auth_user_id IS NULL`) and linking is enabled** — this
   is a legacy account, so it is **claimed** for the new identity. Only the
   mapping column is filled; the id, role, phone and everything else are kept.
   This is the mechanism by which a pre-migration account eventually maps to Neon
   Auth. See `MIGRATION.md` §4 — it is **off by default**.
2. **Otherwise** — the row belongs to somebody. Provisioning throws with
   user-facing copy. Silently reusing or overwriting it would be an
   account-takeover path.

A row already mapped to a *different* provider identity is never reassigned, even
with linking enabled.

Provisioning is idempotent and conservative: it may confirm an email address but
never un-confirm one (`undefined` means "leave as-is" in Prisma), and it never
touches phone, role, name or county — those belong to the user.

---

## 5. Middleware

`src/middleware.ts` does one thing: establish whether the request has a valid
Neon Auth session, for the routes that need one.

### Route ownership (`config.ts`)

```
PROTECTED_PREFIXES   /dashboard   /messages   /notifications
AUTH_ROUTE_PREFIXES  /login  /register  /forgot-password  /reset-password
                     /verify-email  /complete-profile
```

Everything else — the landing page, marketplace, product pages, seller storefronts
— is public and **never handed to the auth service**. An anonymous visitor
browsing products costs MaliHub no session validation and no database query.

The SDK's own `auth.middleware()` protects *everything* except a hard-coded skip
list (`/api/auth`, `/auth/sign-in`, …) that matches none of MaliHub's routes.
Applied globally it would gate the landing page and `/login` itself, so MaliHub
decides which requests to hand to the SDK and this list is that decision.

### The OAuth / emailed-link return

The auth service sends the browser back to `callbackURL` with a one-time
`?neon_auth_session_verifier=` parameter. The SDK exchanges it for session cookies
scoped to MaliHub's own origin — and that exchange is the *only* way the browser
ends up holding a MaliHub session after a redirect-based flow.

So a request carrying that parameter is handed to the SDK **even when its path is
not protected** (`/complete-profile` is an auth route, not a protected one).
Without this, Google sign-in would land the browser back on MaliHub with no
session cookie at all.

The verifier is stripped from any `redirectTo` middleware records. It is a
one-time credential and must never be persisted into a redirect target, a log
line, or a bookmarkable URL.

### Failing closed

Three failure modes, one rule — a protected route is never served when identity
cannot be established:

| Condition | Response |
|---|---|
| Auth not configured (missing/placeholder env vars) | `307 → /login?redirectTo=…` + `console.error` |
| SDK throws | `307 → /login?redirectTo=…` + `console.error` |
| Auth service unreachable | the SDK's own redirect (it fails closed internally) |

A redirect rather than an exception: `/login` still renders and the auth actions
report the misconfiguration, instead of every dashboard URL returning an opaque
edge-runtime 500.

An auth-*return* request is allowed through when unconfigured — there is nothing
to exchange, and the landing page showing a signed-out state is more useful than a
redirect loop.

---

## 6. `force-dynamic` is required, not optional

Every route that reads a session declares:

```ts
export const dynamic = "force-dynamic";
```

This is not boilerplate. Previously these routes were dynamic *incidentally*:
constructing a Supabase client called `cookies()`, which Next.js treats as an opt
into dynamic rendering. Reading a Neon Auth session does **not** always touch a
cookie — when the auth environment is unconfigured, the read short-circuits before
reaching `next/headers`.

The consequence of omitting the declaration is severe and invisible in
development: a build run without `NEON_AUTH_BASE_URL` prerenders
`/notifications`, `/buyer/wishlist`, `/seller` and the marketing layout as
**static** pages — the marketing header frozen in its signed-out state, and every
protected page frozen as a redirect to `/login`. It ships that way, and the
failure looks like "authentication is broken" rather than "this page was
prerendered".

Verified in the build output: every auth-dependent route reports `ƒ (Dynamic)`,
and only genuinely static routes (`/login`, `/register`, `/forgot-password`,
`/robots.txt`, `/sitemap.xml`) report `○`.

---

## 7. Guards

All in `src/lib/auth/session.ts`. Two families, because a Server Component and a
Server Action must fail differently.

### Redirecting guards (layouts, pages)

`redirect()` throws by design in Next.js, so call sites need no null check.

| Guard | Requires | On failure |
|---|---|---|
| `requireUser()` | session + mapped row + not banned/inactive | `/login`; banned → `/`; unmapped → `/complete-profile` |
| `requireOnboardedUser()` | the above + `profiles.onboarded` | `/complete-profile` |
| `requireSellerAccess()` | the above + a `sellers` row **or** admin role | `/dashboard/buyer` |
| `requireAdministrator()` | the above + `ADMIN`/`SUPER_ADMIN` | `/` |
| `requireRole(roles)` | the above + role in list | `/dashboard/buyer` |

A banned account is redirected to `/`, **not** `/login`: the account exists and
authenticates fine, so bouncing it to the sign-in form is both confusing and a way
to probe which accounts are banned.

`requireUser()` redirects to `/login` *without* a `redirectTo` parameter. That is
deliberate. Middleware already bounced unauthenticated visitors away from
protected routes **with** a `redirectTo`, so reaching this branch means the session
was lost mid-render or the route is not middleware-protected — and there is no
reliable way to read the current pathname from a Server Component in the App
Router. Inventing one from the `referer` header would be a guess, and a wrong
guess here is an open-redirect risk. The cost is that this rare path loses the
return destination.

### Answering guards (Server Actions)

A Server Action's caller is a form expecting a result to toast. A thrown redirect
would surface as Next's error boundary instead.

| Guard | Returns |
|---|---|
| `requireActionUser()` | `{ ok: true, identity, user }` or `{ ok: false, error, failure }` |
| `requireOnboardedActionUser()` | as above, plus `onboarded` |
| `requireActionIdentity()` | `{ ok: true, identity }` — **no application row required** |

`requireActionIdentity()` exists for exactly one flow: `/complete-profile`. A
brand-new account can legitimately reach it before its `users`/`profiles` rows
exist (sign-up provisioning is best-effort), and the profile write provisions them
authoritatively inside its own transaction. Requiring a mapped user there would
make first-time onboarding impossible — the repair path would require the thing it
repairs.

### Request-scoped memoization

`getAuthContext()` is wrapped in `React.cache()`. A single render passes through a
layout, a page and several components, each of which may want the current user;
`cache()` collapses those into one session read and one authorization read per
request.

---

## 8. Flows

### Sign up
```
register form → signUpAction
  → providerSignUp({ email, password, name })
      name is NOT NULL upstream; the form collects no name, so it is seeded from
      the email local part rather than sending "" and failing registration
  → provisionUserRows(identity)      BEST EFFORT
  → success; the form routes to /verify-email?email=…
```
Provisioning failure is logged, not surfaced: the auth account already exists, and
`/complete-profile` provisions authoritatively on submit. Failing the action would
lose a real account to a database blip.

### Sign in
```
login form → signInAction(input, redirectTo?)
  → providerSignIn({ email, password })
  → provisionUserRows(identity)                  BEST EFFORT (self-heals, links legacy)
  → readOnboardingState(userId)                  AUTHORITATIVE — may not fail silently
  → destination = onboarded ? (safeInternalRedirect(redirectTo) ?? dashboardFor(state))
                            : "/complete-profile"
```
If the authoritative read fails, the action **clears the session and reports
failure**. Authentication succeeded, but the application cannot safely keep a
session whose authorization state it cannot verify. A database outage must never be
reported as "not onboarded" — that is how an outage turns into every customer
being redirected to `/complete-profile`.

`dashboardFor()` keys seller routing on the `sellers` row, not on `role ===
"SELLER"`, matching `requireSellerAccess()`.

### Google OAuth
```
google button → signInWithGoogleAction(next?)
  → providerSignInWithGoogle({ callbackURL: `${origin}${target}` })   disableRedirect: true
  → redirect(data.url)                       ← the provider's authorize URL
  → Google → {NEON_AUTH_BASE_URL}/callback/google → back to callbackURL
      with ?neon_auth_session_verifier=… → middleware lets it through → SDK exchanges
```
`disableRedirect: true` is what makes this usable from a Server Action: the service
returns the authorize URL in the response body instead of answering with a
`Location` header that our `fetch` would have to interpret. MaliHub then hands the
URL to Next's `redirect()`.

Two production prerequisites follow (`MIGRATION.md` §5): Google's *authorized
redirect URI* must be `{NEON_AUTH_BASE_URL}/callback/google` — the auth service's
own endpoint, **not** a MaliHub route — and `callbackURL`'s origin must be on the
branch's trusted-domain allowlist.

`/api/auth/callback` is retired and answers **410 Gone**. It used to be the single
landing point for OAuth, email-confirmation and password-recovery links. There is
nothing left for it to exchange, and re-implementing a code-for-session swap there
would put a second, parallel authentication path back into the app.

### Password reset
```
forgot-password form → forgotPasswordAction
  → providerRequestPasswordReset({ email, redirectTo: `${origin}/reset-password` })
  → always the same answer, registered or not       (no account enumeration)
emailed link → /reset-password?token=…  (or ?error=INVALID_TOKEN after 15 minutes)
  → resetPasswordAction(input, token)
  → providerResetPassword({ newPassword, token })   one-time, consumed
```
**This is a behaviour change.** The previous provider exchanged the emailed link
for a logged-in "recovery" session, so the action needed no token and simply called
`updateUser({ password })`. The new provider consumes a one-time token and
establishes no session — so `/reset-password` and `resetPasswordAction` must work
while **signed out**. Requiring a session there would make password reset
impossible.

`forgotPasswordAction` reports only a genuine outage as an error. Everything else
gets the identical neutral response, because a per-email difference would turn the
form into a directory of MaliHub customers.

### Email verification — both paths
```
/verify-email → "Resend verification email"
  → resendVerificationAction(email)
      → providerSendVerificationEmail(...)         LINK (needs a custom email provider)
        ├─ success                    → { method: "link" }
        ├─ capability_not_enabled     → providerSendVerificationCode(...)  → { method: "code" }
        └─ any other failure          → surfaced (a rate limit is not "links are off")

code path → verifyEmailWithCodeAction({ email, code })
  → providerVerifyEmailWithCode(...)     may auto-sign-in (provider default)
  → re-read the session; three outcomes, three destinations:
      not signed in            → /login
      signed in, no app row    → /complete-profile
      signed in, app row       → onboarded ? dashboard : /complete-profile
```
Both paths exist because they have different prerequisites on a Neon branch.
Rather than fail when links are unavailable, the action asks for a code and tells
the form which one to expect — the person gets verified either way, and no MaliHub
code has to guess how the branch was configured.

Collapsing the three outcomes would send somebody who just verified their address
back to a sign-in form they no longer need.

---

## 9. Error contract

`errors.ts` normalizes every provider failure into:

```ts
type AuthFailure = { code: AuthFailureCode; message: string; status?: number };
```

Codes: `invalid_credentials`, `email_taken`, `email_not_verified`,
`weak_password`, `invalid_token`, `rate_limited`, `auth_unavailable`,
`auth_not_configured`, `capability_not_enabled`, `app_database_unavailable`,
`no_application_user`, `account_banned`, `unknown`.

Three of them exist to prevent specific misreporting:

- **`auth_unavailable` vs `invalid_credentials`.** During an auth-service outage,
  telling every customer their password is wrong causes a wave of resets and
  lockouts for a problem entirely on our side. Transport failures are classified as
  outages and never as credential problems.
- **`capability_not_enabled`.** Distinct from `unknown` because a caller can
  legitimately fall back to another mechanism — which is exactly what
  `resendVerificationAction` does.
- **`app_database_unavailable` vs `no_application_user`.** The first means "we
  could not read"; the second means "we read, and there is nothing there". Treating
  an unreadable database as "no privileges" would let an outage downgrade an
  administrator; treating it as "signed out" would send a paying customer with a
  valid session to the login page during a blip.

`message` is always safe to show. It never contains a token, a cookie value, a
submitted password, or the cookie secret. Provider failures are logged as a code
plus HTTP status only.

---

## 10. What Supabase still does

Supabase remains installed and in use, for two features that are **not** auth:

| Feature | Where | Why it stays |
|---|---|---|
| Storage — profile avatars | `src/components/auth/avatar-upload.tsx` | Storage is not authentication; nothing about the migration replaces it |
| Realtime — chat presence/typing | `src/hooks/use-chat-realtime.ts` | Unrelated to identity |

What is **retained but inert**:

| File | Status |
|---|---|
| `src/lib/supabase/auth-legacy.ts` | the complete retired Supabase auth implementation — the rollback target |
| `src/lib/supabase/middleware.ts` | `updateSession()` — no longer imported by anything |
| `src/lib/supabase/{client,server}.ts` | still used, for Storage/Realtime only |

Nothing in the request path calls `supabase.auth.*`. `auth-legacy.ts` and
`middleware.ts` are kept unmodified for one reason: rollback is only a quick
revert if they still exist exactly as they were. See `MIGRATION.md` §9.

---

## 11. Security properties

| Property | How it holds |
|---|---|
| No open redirect | `safeInternalRedirect()` rejects protocol-relative (`//host`), backslash-normalized (`/\host`), absolute external, `javascript:` and `data:` targets. Used by middleware, `signInAction` and `signInWithGoogleAction`. |
| No account enumeration | `forgotPasswordAction` answers identically for registered and unregistered addresses; only an outage is reported. |
| No privilege escalation via token | There is no role claim to forge. `requireAdministrator()` reads a Postgres row; a session payload has nowhere to put a role. |
| Fail closed | Unconfigured, unreachable, or throwing auth → protected routes redirect to `/login`. Unreadable application database → guards refuse rather than assume. |
| No account takeover via linking | Legacy claim requires an explicit opt-in flag, only fills a NULL mapping, and never reassigns a row already mapped to another identity. |
| One-time credentials stay one-time | The OAuth verifier is stripped from every recorded redirect target; reset tokens are consumed. |
| Secrets stay server-side | `NEON_AUTH_BASE_URL` / `NEON_AUTH_COOKIE_SECRET` are never `NEXT_PUBLIC_*`. Placeholder values from `.env.example` are rejected rather than used. |
| Banned accounts cannot probe | A banned user is redirected to `/`, not `/login`, so the sign-in form cannot be used to discover which accounts are banned. |

---

## 12. Testing

209 tests across 47 suites (`npm test`). Four layers, deliberately:

| Layer | File | Mocks | Runs for real |
|---|---|---|---|
| **Provider integration** | `src/lib/auth/__tests__/provider-integration.test.ts` | a local HTTP stand-in for the Better Auth REST service + the `next/headers` cookie jar | **the real `@neondatabase/auth` SDK** and all of `neon.ts` |
| **Authorization** | `src/lib/auth/__tests__/guards.test.ts` | `neon.ts`, Prisma | every guard, the identity mapping, error normalization |
| **Actions** | `src/app/(auth)/__tests__/{sign-in,complete-profile,auth-flows}-action.test.ts` | `neon.ts`, Prisma | the actions, `auth-service`, `account-provisioning`, guards |
| **Edge units** | `src/lib/auth/__tests__/auth-units.test.ts`, `src/__tests__/middleware.test.ts` | `neon.ts` (middleware only) | `config`, `redirects`, `errors`, `toAuthIdentity`, `middleware()` |
| **Provisioning** | `src/services/__tests__/account-provisioning.test.ts` | an in-memory store with real Postgres semantics | provisioning, the collision rule, the transaction |

The integration layer is the one that earns its runtime. A test that mocks the
adapter proves only that the test agrees with itself; this one proves the calls
MaliHub makes reach endpoints the service actually serves, with bodies it actually
accepts — the class of mistake (a renamed endpoint, an omitted `disableRedirect`, a
token parameter that does not exist) that a mocked test cannot catch and a first
production login would.

Several tests assert **absences** on purpose — that `signInAction` makes no provider
call beyond the sign-in, that `completeProfileAction` makes none at all after the
write commits. Those are the tripwires: if a claim cache ever creeps back in, it
has to show up as a provider call, and these fail first.

Shared fixtures live in `src/services/__tests__/fake-account-store.ts` (a Prisma
stand-in that mirrors `P2025`, `P2002` and transaction rollback) and
`src/lib/auth/__tests__/mock-auth-upstream.ts`.
