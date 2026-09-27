# MaliHub Kenya — Neon Auth Migration: Final Report

**Branch:** `arena/01a0d6e7-malihub-kenya` · **Commit:** `3836237`
**Nothing pushed, merged, or deployed.** No production environment variable was
changed and no existing user was migrated.

Companion documents: [`ARCHITECTURE.md`](./ARCHITECTURE.md) (how auth works now) ·
[`MIGRATION.md`](./MIGRATION.md) (cutover, legacy users, rollback)

---

## 1. Executive summary

Neon Managed Better Auth is now MaliHub Kenya's only authentication provider.
Supabase remains installed and in use — for Storage (profile avatars) and Realtime
(chat) — but nothing in the request path calls `supabase.auth.*`.

The migration's real content is architectural, not a provider swap. Authorization
used to be read from the provider's `app_metadata` JWT claims, *including in
middleware on every request*. Those claims were a cache of `users.role`,
`profiles.onboarded` and the existence of a `sellers` row — and a cache that lagged
the database produced a dashboard ↔ `/complete-profile` redirect loop this
repository had to fix twice. Neon Auth exposes no equivalent, so the cache is gone
entirely rather than reimplemented:

```
middleware  →  "is there a valid session?"        no DB query, fails closed
guards      →  "what may this account do?"        authoritative Prisma read
```

**Result:** 209 frontend tests passing (from 71) and 481 backend tests (from
393), type-check and lint clean on both services, build succeeds, edge bundle
down from 107 kB to 75 kB. One module in the entire application imports the SDK.

The same split had to be applied to the **FastAPI backend**, which verified
Supabase JWTs and read `app_metadata.role` from them. It is migrated in this
change (§8): it verifies Neon Auth tokens against the service's JWKS, resolves
the provider's `sub` to `users.id` through `users.auth_user_id`, and reads role,
onboarding and seller status from Postgres. Deploy order still matters — see
`MIGRATION.md` §7.

---

## 2. Scope and constraints honoured

| Constraint | Status |
|---|---|
| Do not delete the Supabase project, packages, or infrastructure | ✅ packages installed and importable; Storage + Realtime still in active use |
| Do not migrate or delete existing users | ✅ zero rows touched; strategy documented only (`MIGRATION.md` §4) |
| Do not modify production env vars | ✅ only `.env.example` changed |
| Do not deploy or merge | ✅ nothing merged; `main` untouched. Pushed to the session branch and PR #11 opened on request — Vercel builds a *preview* automatically, which is not a production deploy |
| No destructive DB migration | ✅ one additive, nullable column |
| Do not upgrade Next.js or unrelated deps | ✅ `package.json`/`package-lock.json` untouched. `backend/pyproject.toml` gained one dependency: `cryptography` moved from the optional `jwks` extra into core, because JWKS is now the only way to verify a token and there is no shared secret. No version upgrades anywhere |
| Do not reproduce the `app_metadata` architecture | ✅ no claim cache exists; tests assert its *absence* |
| Do not leave the POC short-circuit in middleware | ✅ POC deleted; middleware has a single path and no feature flag |
| `users.id` stays `String @id @db.Uuid` | ✅ unchanged; provider id lives in a separate column |
| Abstraction layer so app code doesn't couple to the SDK | ✅ `src/lib/auth/`; exactly one SDK importer |
| Stop depending on `app_metadata.role/onboarded/has_seller_profile` | ✅ verified: zero reads outside the retained legacy file, in either service |

Three ambiguities were resolved by asking rather than assuming: POC routes
**deleted** (reusable pieces promoted), email verification implemented as
**both** link and code, and middleware **authentication-only** with server-side
authorization confirmed.

---

## 3. Architecture: before and after

| Concern | Before (Supabase) | After (Neon Auth) |
|---|---|---|
| Session validation | middleware, every request | middleware, every request (unchanged) |
| Role / onboarding / seller access | `app_metadata` JWT claims, read in middleware | Postgres rows, read by guards |
| Claim freshness | required `refreshSession()` to re-mint the browser JWT | nothing to refresh — no claim exists |
| Application user id | **was** the provider's id (shared PK) | MaliHub-generated UUID; provider id mapped separately |
| Provisioning trigger | sign-up, sign-in, `/api/auth/callback`, `/complete-profile` | sign-up, sign-in, `/complete-profile` (no callback route) |
| Password reset | recovery **session** → `updateUser({password})` | one-time **token** → `resetPassword({newPassword, token})` |
| Google OAuth | MaliHub `/api/auth/callback?code=` exchange | auth service owns the handshake; returns to `callbackURL` |
| Email verification | provider default (link) | link **and** code, chosen at runtime |
| Failure model | mixed; some paths failed open | fails closed, with distinct codes for outage vs. credentials |

---

## 4. Identity model and the schema change

```
neon_auth.user.id  ───maps to───▶  users.auth_user_id   (TEXT, UNIQUE, nullable)
                                   users.id             (UUID, MaliHub-generated)
                                        ▲
                                        └── target of EVERY foreign key
```

`users.id` is deliberately **not** the provider's id. Every foreign key in the
schema — products, orders, messages, notifications, wishlist, sellers — targets it,
so holding a provider-issued value there would make the next provider change a
database rewrite. As built, a provider change is a backfill of one nullable column.
The provider's id is stored as `TEXT`, matched by equality, and never parsed or
assumed to be a UUID.

Migration `prisma/migrations/20260925000000_add_auth_user_id_mapping/`:

```sql
ALTER TABLE "users" ADD COLUMN "auth_user_id" TEXT;
CREATE UNIQUE INDEX "users_auth_user_id_key" ON "users"("auth_user_id");
```

Safe to run at any time: nullable (every existing row becomes "not yet mapped"),
additive (nothing renamed, retyped or dropped), and a unique index on a nullable
column permits many NULLs in Postgres, so all legacy rows coexist.

**Provisioning is split into a read half and a write half**, which matters for
performance: `findMappedApplicationUserId()` (read-only) backs every guard, while
`resolveApplicationUserId()` (creates or claims) runs only where an identity is
established. Guards run on essentially every request — including public marketing
pages — so a provisioning guard would put two writes on the hottest path in the app.

**Email collisions** are handled by rule, not by luck. An unmapped legacy row may be
claimed *only* when `MALIHUB_AUTH_LINK_UNMAPPED_BY_EMAIL=true`, and claiming writes
**only** the mapping column. A row already mapped to a different identity is never
reassigned, with linking on or off — that would be an account-takeover path.

---

## 5. The abstraction layer

```
src/lib/auth/
├── index.ts      Public barrel — the only auth import application code uses
├── config.ts     Env resolution, route ownership, verifier handling   (edge-safe)
├── redirects.ts  safeInternalRedirect(), loginUrlWithRedirect()       (edge-safe)
├── errors.ts     Provider errors → MaliHub's AuthFailure contract     (edge-safe)
├── neon.ts       THE ONLY module importing @neondatabase/auth         (edge-safe)
├── types.ts      AuthIdentity, ApplicationAccess, AuthFailureCode     (edge-safe)
├── identity.ts   Provider session → application user (Prisma)         (server-only)
└── session.ts    Guards: requireUser(), requireSellerAccess(), …      (server-only)
```

Verified isolation:

- **Exactly one import of `@neondatabase/auth`** in the whole repository:
  `src/lib/auth/neon.ts:28`.
- **`src/middleware.ts` imports only `config`, `redirects` and `neon`** — never the
  barrel, which re-exports the `server-only` modules that pull in Prisma. That rule
  is why the edge bundle is 75 kB.
- **~25 call sites rewired** off `supabase.auth.getUser()` onto
  `requireUser()` / `getCurrentUser()` / `requireSellerAccess()` and friends.
- Provider operations are translated into MaliHub's own contract
  (`AuthIdentity`, `AuthFailure`), so no caller sees an SDK type.

Rollback is therefore a change to `neon.ts` plus `config.ts`, not a sweep across the
app (`MIGRATION.md` §9).

---

## 6. Middleware

Answers one question: **is there a valid session?** No database call, no
authorization opinion.

**Route ownership** is MaliHub's decision, not the SDK's. The SDK's own
`auth.middleware()` protects everything except a hard-coded skip list (`/api/auth`,
`/auth/sign-in`, …) that matches none of MaliHub's routes — applied globally it
would gate the landing page and `/login` itself.

```
PROTECTED   /dashboard  /messages  /notifications
AUTH ROUTES /login /register /forgot-password /reset-password /verify-email /complete-profile
PUBLIC      everything else — never handed to the auth service at all
```

An anonymous visitor browsing products costs no session validation and no query.

**The OAuth return is the subtle part.** The auth service sends the browser back
with a one-time `?neon_auth_session_verifier=`; the SDK exchanges it for session
cookies on MaliHub's origin. That exchange is the *only* way the browser ends up
holding a MaliHub session after a redirect-based flow, so such a request is handed
to the SDK **even when its path is not protected** (`/complete-profile` is an auth
route). Without this, Google sign-in would land with no session cookie at all. The
verifier is stripped from any recorded `redirectTo` — it is a one-time credential
and must never be persisted into a redirect target, a log line, or a bookmark.

**Fails closed.** Unconfigured, throwing, or unreachable auth → protected routes
redirect to `/login?redirectTo=…`, never serve. A redirect rather than an exception,
so `/login` still renders and the actions report the misconfiguration instead of
every dashboard URL returning an opaque edge 500.

**The POC short-circuit is gone.** There is one path and no feature flag selecting
between two.

### `force-dynamic` — a build-time trap found and fixed

Previously these routes were dynamic *incidentally*: constructing a Supabase client
called `cookies()`, which Next.js treats as opting into dynamic rendering. Reading a
Neon Auth session does **not** always touch a cookie — an unconfigured environment
short-circuits first. A build run without `NEON_AUTH_BASE_URL` therefore prerendered
`/notifications`, `/buyer/wishlist`, `/seller` and the marketing layout as **static**
pages: the header frozen signed-out, every protected page frozen as a redirect to
`/login`. It ships that way and looks like "authentication is broken".

All 13 session-reading routes now declare `export const dynamic = "force-dynamic"`
explicitly. Verified in the build output: the only `○ (Static)` routes left are
`/_not-found`, `/forgot-password`, `/login`, `/register`, `/robots.txt`,
`/sitemap.xml`.

---

## 7. Server Actions and flows

All 8 actions rewritten against the abstraction layer, plus
`verifyEmailWithCodeAction` added. Zod validation, the `ApiResult` envelope,
`safeInternalRedirect`, per-field errors and the existing user-facing copy are
preserved.

| Action | Provider call | Notes |
|---|---|---|
| `signUpAction` | `signUp.email({email,password,name})` | `name` is NOT NULL upstream and the form collects none → seeded from the email local part rather than sending `""`. Provisioning is best-effort. |
| `signInAction` | `signIn.email` | Authoritative state read after; **fails closed and clears the session** if it cannot be read. |
| `signInWithGoogleAction` | `signIn.social({provider,callbackURL,disableRedirect:true})` | `disableRedirect` is what makes it callable from a Server Action — the URL comes back in the body, not as a `Location` header. |
| `forgotPasswordAction` | `requestPasswordReset({email,redirectTo})` | Identical answer whether or not the address exists; only an outage is reported. |
| `resetPasswordAction` | `resetPassword({newPassword,token})` | **Signature changed** — takes the token. Works while signed out. |
| `resendVerificationAction` | `sendVerificationEmail` → `emailOtp.sendVerificationOtp` | Returns `{method: "link" \| "code"}` so the form adapts. |
| `verifyEmailWithCodeAction` | `emailOtp.verifyEmail({email,otp})` | **New.** Three outcomes, three destinations. |
| `completeProfileAction` | — | Uses `requireActionIdentity()`: no application row required, because provisioning happens inside its own transaction. |
| `signOutAction` | `signOut()` | Still navigates home even if the provider cannot confirm. |

**Two flows changed shape for real reasons:**

*Password reset* — the old provider exchanged the emailed link for a logged-in
"recovery" session, so the action needed no token. The new one consumes a one-time
token and establishes no session, so `/reset-password` reads `?token=` and both the
page and the action must work while signed out. Requiring a session there would have
made password reset impossible.

*Email verification* — links require a custom email provider on the branch; codes
work with the shared one available immediately. Rather than fail when links are
unavailable, the action asks for a code and tells the form which one to expect. After
verification the session is re-read, because the provider may auto-sign-in; the three
outcomes (signed out / signed in unmapped / signed in mapped) get three different
destinations. Collapsing them would send somebody who just verified their address
back to a sign-in form they no longer need.

---

## 8. Authorization guards

`src/lib/auth/session.ts`. Two families, because a Server Component and a Server
Action must fail differently.

**Redirecting** (layouts, pages): `requireUser`, `requireOnboardedUser`,
`requireSellerAccess`, `requireAdministrator`, `requireRole`.

**Answering** (actions): `requireActionUser`, `requireOnboardedActionUser`,
`requireActionIdentity` — returning `{ok:false, error, failure}` rather than
throwing, because a form expects a result to toast and a thrown redirect surfaces as
Next's error boundary.

Decisions worth recording:

- **Seller access keys on the `sellers` row, not `role === "SELLER"`.** A SELLER-role
  account whose row was never created must not see an empty seller dashboard;
  administrators pass for support.
- **A banned account goes to `/`, not `/login`.** It authenticates fine, so bouncing
  it to the sign-in form is confusing *and* a way to probe which accounts are banned.
- **`requireUser()` omits `redirectTo`** when the session dies mid-render. Middleware
  already supplied one for the normal case; there is no reliable way to read the
  current pathname from a Server Component, and inventing one from `referer` would be
  an open-redirect risk. The rare path loses its return destination, deliberately.
- **`getAuthContext()` is wrapped in `React.cache()`** so a layout, page and several
  components cost one session read and one authorization read per request.
- **`requireActionIdentity()` exists for exactly one flow** — `/complete-profile`. A
  brand-new account can arrive before its rows exist, and requiring a mapped user
  there would make first-time onboarding impossible: the repair path would require the
  thing it repairs.

### The same rule in the FastAPI backend

`backend/` is a separate service that verifies the tokens MaliHub's users
present. It was reading Supabase JWTs and taking `role`, `onboarded` and
`has_seller_profile` from `app_metadata` — the same claim cache, on the other
side of the network. Left alone it would have rejected every token the migrated
app issues, so it is migrated here too, to the same rule.

| | Next.js | FastAPI |
|---|---|---|
| Authentication | Neon Auth session cookie, verified in middleware | Neon Auth JWT, verified against JWKS |
| Authorization | Prisma read in `src/lib/auth/session.ts` | Postgres read in `backend/app/core/identity.py` |
| Claim cache | none | none |
| Rollback path | `src/lib/supabase/auth-legacy.ts` | `AUTH_PROVIDER=supabase-legacy` |

Three details are worth stating because each is a way to be silently wrong:

- **`sub` is not `users.id`.** The JWT subject is `neon_auth.user.id`. The
  backend resolves it through `users.auth_user_id` and exposes the result as
  `AuthContext.subject`, keeping the provider id separately as
  `AuthContext.auth_user_id`. A backend that conflated them would verify every
  token successfully and then query the wrong id — finding nothing, or someone
  else's rows. Nothing raises, which is what makes it dangerous.
- **The token's `role` claim is ignored.** Neon Auth does carry a `role` claim,
  and its value is `"authenticated"` — a Postgres/RLS role. Reading it as an
  application role would make every signed-in user identical. A test asserts
  that a token claiming `"role": "SUPER_ADMIN"` produces a non-staff context.
- **"Not found" and "cannot answer" are different.** No mapping row → `403`;
  database or JWKS unreachable → `503`. Reporting an outage as "you have no
  account" is the backend-shaped version of the redirect loop, and both cases
  are pinned by tests.

Two things this makes possible, and one it costs. Because authorization is now
a database read, **bans and deactivations take effect on the next request**
instead of at token expiry — the stateless Supabase verifier could not do this
at all, and its own docstring said so. And because JWKS verification uses
public keys, the backend holds **no credential that could mint a token**. The
cost is one indexed lookup per authenticated request, which is the price of an
answer that cannot go stale.

`SupabaseJwtVerifier` and every `SUPABASE_*` setting are retained unmodified
behind `AUTH_PROVIDER=supabase-legacy`, so rollback stays a configuration
change. Exactly one provider is ever active and there is **no cross-provider
fallback**: a backend that accepted both would honour a stale Supabase token for
as long as it remained unexpired after the cutover, which is the whole window a
leaked credential needs. A configured `SUPABASE_JWT_SECRET` does not rescue a
Neon-selected deployment — it reports `unconfigured` and fails closed.

---

## 9. Supabase: what stays, what is retired

| Capability | Status |
|---|---|
| **Auth** | removed from the request path; code retained in `src/lib/supabase/auth-legacy.ts` |
| **Storage** — profile avatars | **kept** (`src/components/auth/avatar-upload.tsx`). Storage is not authentication. |
| **Realtime** — chat presence/typing | **kept** (`src/hooks/use-chat-realtime.ts`). Unrelated to identity. |
| `src/lib/supabase/{client,server}.ts` | kept; used for Storage/Realtime only |
| `src/lib/supabase/middleware.ts` | kept, **imported by nothing**; part of the rollback target |
| `/api/auth/callback` | retired → **410 Gone** with an explanatory page for old emailed links |
| `manual_auth_trigger.sql` | obsolete (mirrored Supabase `auth.users` into `users`) |
| `manual_rls_policies.sql`, `manual_storage_avatars.sql` | still apply — RLS remains the backstop |
| POC (`/neon-auth-test`, `src/lib/neon-auth/`) | **deleted**; the reusable mock upstream was promoted to `src/lib/auth/__tests__/` |

`auth-legacy.ts` and `supabase/middleware.ts` are preserved **unmodified** for one
reason: rollback is only a quick revert if they still exist exactly as they were.
They are not imported, not bundled, and not in any request path.
`docs/neon-auth-poc/REPORT.md` is marked superseded, with its invalid "32-char
non-UUID ids" finding explicitly retracted — that observation came from the POC's own
mock, never from the live service, and nothing depends on the provider's id format.

---

## 10. Testing and validation

**209 tests / 47 suites passing** (baseline: 71 / 16).

| Layer | File | Mocked | Runs for real |
|---|---|---|---|
| Provider integration | `src/lib/auth/__tests__/provider-integration.test.ts` | local HTTP stand-in for the Better Auth REST service + the `next/headers` cookie jar | **the real `@neondatabase/auth` SDK** and all of `neon.ts` |
| Authorization | `src/lib/auth/__tests__/guards.test.ts` | `neon.ts`, Prisma | every guard, identity mapping, error normalization |
| Actions | `src/app/(auth)/__tests__/{sign-in,complete-profile,auth-flows}-action.test.ts` | `neon.ts`, Prisma | the actions, `auth-service`, `account-provisioning`, guards |
| Edge units | `src/lib/auth/__tests__/auth-units.test.ts`, `src/__tests__/middleware.test.ts` | `neon.ts` (middleware only) | `config`, `redirects`, `errors`, `toAuthIdentity`, `middleware()` |
| Provisioning | `src/services/__tests__/account-provisioning.test.ts` | in-memory store with real Postgres semantics | provisioning, the collision rule, the transaction |

The integration layer earns its runtime. A test that mocks the adapter proves only
that the test agrees with itself; this one proves the calls MaliHub makes reach
endpoints the service actually serves, with bodies it actually accepts — the class of
mistake (a renamed endpoint, an omitted `disableRedirect`, a token parameter that does
not exist) that a mocked test cannot catch and a first production login would. Every
endpoint path was verified against the installed SDK's `API_ENDPOINTS` table.

**Several tests assert absences on purpose** — that `signInAction` makes no provider
call beyond the sign-in, that `completeProfileAction` makes none at all after the
write commits. Those are tripwires: if a claim cache ever creeps back in it must
show up as a provider call, and these fail first.

Shared fixtures: `src/services/__tests__/fake-account-store.ts` (mirrors `P2025`,
`P2002` and transaction rollback) and `src/lib/auth/__tests__/mock-auth-upstream.ts`.

### Validation results

| Check | Result |
|---|---|
| `npm test` (Next.js) | **209 passed / 0 failed**, 47 suites |
| `pytest` (FastAPI backend) | **481 passed / 0 failed** (from 393) |
| `ruff check backend/` | clean |
| `npm run type-check` | clean |
| `npm run lint` | clean — 0 errors, 0 warnings |
| `npx prisma validate` | schema valid |
| `npm run build` | ✓ compiled; 17 static pages; **middleware 75 kB** (was 107 kB) |
| SDK isolation | exactly one `@neondatabase/auth` import |
| `supabase.auth.*` in request path | none |
| `app_metadata` / `user_metadata` reads | none outside the retained legacy file |
| middleware imports | edge-safe modules only — no barrel, no Prisma |
| backend: SDK import sites | zero — it verifies JWTs with PyJWT against JWKS and never calls the auth API |
| backend: `app_metadata` reads | zero; role/onboarded/seller all come from Postgres |
| backend: mirror fidelity | `tests/test_models.py` parses `schema.prisma` and compares column names, nullability, enum values and constraint names |

Three real defects were found by writing the tests rather than by review, and fixed:
`getAuthContext()` was provisioning on *every* request (two writes on the hottest
path); `verifyEmailWithCodeAction` collapsed "verified but signed out" with "verified,
signed in, no row yet"; and the missing `force-dynamic` declarations (§6). Two
documented-but-unenforced guarantees were also implemented: the 32-character cookie
secret minimum and rejection of `.env.example` placeholder values.

---

## 11. Existing users — strategy documented, NOT executed

**No user was migrated.** Every `users` row has `auth_user_id = NULL` and no Neon Auth
account exists for any current customer. Full plan in `MIGRATION.md` §4.

Credentials cannot be copied — passwords live in Supabase as bcrypt hashes MaliHub
can neither read nor re-hash, and Neon Auth will not import them. So there is no
"move the users" operation. The recommended path is a **lazy claim on first
sign-in**, needing no bulk job and no downtime:

1. Deploy with linking **off**. Legacy sign-in fails cleanly; a fresh registration
   against a legacy email is refused with "your account is being moved" copy. Neither
   creates a duplicate.
2. Create Neon Auth accounts keyed on email (admin API or Console bulk import).
3. Issue password-reset emails — reusing the flow already built.
4. Turn linking **on** for a defined cutover window. The first successful sign-in
   claims the existing row: fills `auth_user_id`, keeps `users.id`, role, phone,
   orders, listings, messages and wishlist exactly as they were.
5. Turn linking **off** again once the mapped population converges.

The flag defaults to off because claiming by email trusts that whoever controls the
mailbox controls the account. That is the same assumption password reset makes, so it
is not unreasonable — but it is a *decision* that should be made for a defined window
by a person. Off, the failure mode is a support conversation; on and unmonitored, it
is an account takeover.

**Sessions do not survive the cutover.** Supabase and Neon Auth cookies are
unrelated, so everybody is signed out at deploy. Unavoidable — announce it rather than
let people discover it.

---

## 12. Risks, rollback, and open items

### Rollback

Viable in full **as long as no mapping has been written**: revert the deploy, restore
the middleware call to `updateSession()`, and the retained legacy files do the rest.
Because application code depends on `@/lib/auth` rather than on a provider, rollback
does **not** require editing the ~25 feature files — the seams are `middleware.ts`,
`(auth)/actions.ts`, `session.ts`'s `getAuthContext()`, and `account-provisioning.ts`'s
mapping key.

After mappings exist, the Supabase accounts are all still there (nothing deleted or
altered them), so sign-in is restored for anyone holding an old credential. Accounts
*created new* during the window need a reset. **Keep `auth_user_id` populated even
after a rollback** — it is the record of who signed in during the window and makes a
second attempt resumable. `MIGRATION.md` §9.

### Must happen before this serves traffic

| Item | Consequence if skipped |
|---|---|
| **Backend deployed before/with the app** (`MIGRATION.md` §7) | The code change is **done** (§8) — the backend verifies Neon JWTs and resolves `sub` → `users.id`. What remains is *ordering*: an app issuing Neon tokens to a still-deployed Supabase-expecting backend fails every authenticated API call. `AUTH_PROVIDER=neon`, `NEON_AUTH_BASE_URL` and `DATABASE_URL` must be set in `backend/.env`; the last is now required for authorization, not just for payments. |
| Google redirect URI = `{NEON_AUTH_BASE_URL}/callback/google` | Google sign-in fails outright. It is **not** a MaliHub route. |
| Trusted domains include preview origins | Google sign-in fails *only* on previews — easy to miss, easy to mistake for a code bug. |
| Custom email provider (if links are wanted) | Only verification codes fire. `/verify-email` adapts, so this degrades rather than breaks. |
| Verify the build route table shows `ƒ` | Static protected pages ship as permanent redirects to `/login` (§6). |

### Residual risks

| Risk | Mitigation |
|---|---|
| Cookie secret rotated by a deploy | Documented as stable-and-stored-in-a-secret-manager; short/placeholder values are rejected at config time. Rotation signs everybody out silently, which reads as "MaliHub keeps logging me off". |
| Linking flag left on indefinitely | Off by default; `MIGRATION.md` §4 step 5 says to close the window. |
| Provider outage reported as bad credentials | Distinct `auth_unavailable` code; covered by tests at the action, guard and integration layers. |
| Database outage read as "not onboarded" | `signInAction` fails closed and clears the session; a dedicated test asserts the outage is *never* reported as an incomplete profile. |
| `@neondatabase/auth` is `0.5.0-beta` | Isolated to one module, with integration tests pinning the wire contract — an SDK behaviour change fails the suite rather than production. |
| **Nothing ran the suite automatically** | The repository had no `.github/workflows`, so all tests executed only when someone remembered to run them locally — nothing prevented a re-introduced claim cache from reaching `main`. **Addressed:** `.github/workflows/ci.yml` now runs both suites, type-check, lint, `prisma validate` and a build on every push and pull request. |

### Explicitly out of scope

No custom Better Auth plugins (the service does not accept them — which is *why* there
is no claim cache, not an obstacle to one). No user migration. No deployment. No
dependency *upgrades* — the one dependency added, `cryptography` in the backend,
is required to verify a JWKS-signed token at all.

The FastAPI backend was originally scoped out and has since been migrated (§8),
because leaving it would have meant the app issued tokens its own API rejected.
