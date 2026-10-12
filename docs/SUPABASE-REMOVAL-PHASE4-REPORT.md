# Supabase removal — Phase 4 completion report

**Date:** 2026-10-12 · **Branch:** `arena/174af3cf-malihub-kenya` · **Phase:** 4 of
[`SUPABASE-REMOVAL-PLAN.md`](./SUPABASE-REMOVAL-PLAN.md) (dependency + dead-code
removal, after Phases 2–3 were implemented and verified).

**Scope decided with the operator before editing:** follow the approved plan §5 —
delete only code confirmed dead and not part of the documented rollback target,
remove the Supabase SDK from `package.json`, keep the Neon Auth rollback set and
the legacy avatar support intact. Three of the four remaining rollback
artefacts are deliberately *kept*, each with an explicit removal trigger below.

---

## 1. What was removed

| Removed | Why it was provably dead |
|---|---|
| `src/hooks/use-chat-realtime.ts` (93 lines) | The Supabase Realtime chat hook (`postgres_changes` + `broadcast` + `presence`). Zero importers: Phase 3 replaced its only consumer (`chat-thread.tsx`) with `useChatSocket`, and the file's own successor documented the swap. Kept until now only because Phase 4 was the agreed removal point. |
| `src/lib/supabase/client.ts` | The browser Supabase client (`createBrowserClient`). Its only importer was `use-chat-realtime.ts` (avatar uploads stopped using it in Phase 2). |
| `package.json → @supabase/supabase-js@2.117.3` | After the two deletions above the package had **no importer** anywhere in `src/`, `scripts/` or `backend/`. |
| `package.json → socket.io-client@4.8.1` | Never imported by any file; it sat in the dependency list as a "later upgrade path" note (`ARCHITECTURE.md` §1). The chat realtime path that could have used it shipped in Phase 3 on the native browser `WebSocket` instead. |
| `next.config.ts` → `https://*.supabase.co` and `wss://*.supabase.co` in CSP **connect-src** | The browser makes no Supabase request any more: avatar uploads go to our own `POST /api/avatar/upload`, chat realtime goes to our own `POST /api/chat/ws-ticket` and then to the FastAPI host. Removing the origins is a real reduction of the CSP's connect surface. |
| `package-lock.json` | Regenerated with the repository's package manager (`npm`, `legacy-peer-deps=true` from `.npmrc`): **16 packages removed** from the tree (`@supabase/supabase-js`, `socket.io-client`, and their transitive dependencies). |

Comment/doc corrections that accompany the removals (no behaviour change, all
in files the removals made stale): `src/lib/supabase/auth-legacy.ts`,
`src/lib/supabase/server.ts`, `src/types/supabase.ts`,
`src/hooks/use-chat-socket.ts`, `src/lib/validations/upload-security.ts`,
`next.config.ts`, `.env.example`, `backend/.env.example`,
`backend/app/main.py` (OpenAPI summary still said "Supabase remains the identity
provider"), `README.md`, `ARCHITECTURE.md`, `docs/auth/MIGRATION.md` (§1, §3, §6,
§9, §10 — its §10 table still described Storage/Realtime as live Supabase
features), `docs/SUPABASE-REMOVAL-PLAN.md` (phase-status header).

Code that was **not** touched by Phase 4: every Server Action, service, route
handler and backend module that runs in production. The diff is a deletion of
two unreferenced modules, two dependency entries, two CSP origins, plus
documentation.

---

## 2. Dependencies

| Package | Status | Note |
|---|---|---|
| `@supabase/supabase-js` | **removed** | last importer deleted in this phase |
| `socket.io-client` | **removed** | never imported |
| `@supabase/ssr` | **kept (rollback-only)** | the only SDK the retained rollback modules import. It declares `@supabase/supabase-js` as a **peer**, so a rollback additionally needs `npm install @supabase/supabase-js@2.117.3` — recorded in `docs/auth/MIGRATION.md` §9, in `.env.example`, and in `src/lib/supabase/server.ts`'s header so the next operator cannot miss it. |
| `@supabase/auth-js` | **kept (transitive)** | pulled in by `@neondatabase/auth` itself (`@neondatabase/auth@0.5.0-beta → @supabase/auth-js@2.79.0`). It is part of the **current** auth stack, not of our Supabase usage; it leaves the lockfile only if Neon Auth stops depending on it. |
| `socket.io` family | **kept transitive only** | whatever remains in the lockfile is a transitive dependency of another package, not a direct dependency. |

---

## 3. What remains, and why (every remaining reference)

A repo-wide `grep -ri supabase` (excluding `node_modules`, `.git`, `.next`,
`.venv`, `__pycache__`) returns the following. Nothing in category A–B performs a
Supabase network call.

### A. Retained Neon Auth **rollback set** — inert, imported by nothing

| File / item | Reason it stays | Removal trigger |
|---|---|---|
| `src/lib/supabase/auth-legacy.ts` | the retired Supabase Auth implementation; `docs/auth/MIGRATION.md` §9 is the rollback runbook | §9: cutover stable for a full release cycle, user migration complete, no rollback exercised, **and** the backend no longer references `SUPABASE_JWT_SECRET` |
| `src/lib/supabase/middleware.ts` | `updateSession()` — the session-refresh half of the same rollback | same |
| `src/lib/supabase/server.ts` | service-role client used by `auth-legacy.ts` | same |
| `src/types/supabase.ts` | `Database` type that `server.ts` is generic over | same |
| `backend/app/core/security.py` (`SupabaseJwtVerifier`), `backend/app/core/config.py` (`SUPABASE_*` settings) | the backend's documented rollback verifier. Default is `AUTH_PROVIDER=neon`; the legacy mode is unselectable by accident, and tests assert it cannot rescue a Neon deployment | same |
| `backend/tests/{test_security,test_config,test_neon_auth,conftest}.py` | they pin that behaviour (including "no cross-provider fallback") | same |
| `.env.example` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`; `backend/.env.example` → `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`, `SUPABASE_JWT_ALGORITHMS`, `SUPABASE_JWT_ISSUER`, `SUPABASE_JWT_AUDIENCE` | read only if that rollback is exercised; every one is now labelled rollback-only, and none is required by the default deployment | same |

**Evidence they are inert:** the edge middleware bundle is **75 kB** and contains
the string `supabase` **zero times**; no client chunk contains Supabase SDK code
(see §5). `tsc --noEmit` passes with `@supabase/supabase-js` absent, which is
also why the peer gap above is a documented rollback step rather than a hidden
build break.

### B. Legacy avatar support — **required**, per the migration's own rules

| File / item | Reason it stays | Removal trigger |
|---|---|---|
| `src/lib/validations/upload-security.ts` (`isOwnSupabaseStorageUrl`) | validates a `Profile.avatarUrl` that is still a pre-migration Supabase URL | after the avatar migration is verified in production |
| `src/lib/validations/auth.ts` (`avatarUrl` refine) | accepts **either** legacy Supabase **or** Cloudinary avatar | same |
| `next.config.ts` → `img-src … https://*.supabase.co` and `images.remotePatterns` entry | `next/image` refuses hosts outside the allowlist — dropping it would break rendering of un-migrated avatars | same |
| `.env.example` → `NEXT_PUBLIC_SUPABASE_URL` | **the one still-required variable:** the project reference legacy URLs are validated against and the source the migration script reads | same |
| `scripts/migrate-avatars-to-cloudinary.mjs` + `scripts/__tests__/migrate-avatars.test.mjs` | the migration itself (idempotent, deterministic `public_id`, never deletes its source) | after the migration has run and been verified |
| `src/app/api/avatar/upload/route.ts` (+ test), `src/lib/cloudinary.ts`, `src/components/auth/avatar-upload.tsx`, `src/app/(auth)/actions.ts` | code and comments that record "never delete a Supabase-hosted avatar" — the safety property that protects existing avatars | same |

### C. Historical DDL and schema documentation — **deleting it is forbidden by the brief**

`prisma/migrations/manual_auth_trigger.sql`, `manual_rls_policies.sql`,
`manual_phase6_rls_realtime.sql`, `manual_phase7_security.sql`,
`manual_phase8_provider_agnostic_payments.sql`, `manual_product_search.sql`,
`manual_storage_avatars.sql`, and the historical notes in
`prisma/schema.prisma` (`users.id` is the legacy Supabase auth UUID,
`auth_user_id` is the mapping, audit-log actors). These are the record of what
was applied to production and of what existing rows mean. `README.md` and
`ARCHITECTURE.md` now mark which parts of them are legacy (the Realtime
publication and the `avatars` bucket) instead of rewriting the files.

### D. Documentation

- **Updated to the post-Phase-4 stack:** `README.md`, `ARCHITECTURE.md`,
  `docs/auth/MIGRATION.md`, `backend/.env.example`, `backend/app/main.py`
  (OpenAPI text), `.env.example`, `docs/SUPABASE-REMOVAL-PLAN.md` (header).
- **Left as history (accurate for their date, not current-state claims):**
  `docs/auth/ARCHITECTURE.md`, `docs/auth/REPORT.md`, `docs/neon-auth-poc/*`,
  `.audit/*`.
- **This report** is the current-state summary.

### E. Remaining comment-only mentions in live code

`src/app/(auth)/actions.ts`, `src/app/(auth)/reset-password/page.tsx`,
`src/app/(dashboard)/messages/layout.tsx`, `src/app/(marketing)/layout.tsx`,
`src/app/api/auth/callback/route.ts`, `src/lib/auth/{errors,index}.ts`,
`src/services/auth-service.ts`, plus the avatar files in category B — each one
explains a deliberate behaviour change or a safety rule ("no `app_metadata`
claim cache", "this route used to exchange the OAuth code", "never delete the
Supabase original"). They are documentation inside code, not dependencies.

### F. Generated artefacts

`tsconfig.tsbuildinfo` (TypeScript incremental cache — updated automatically
because two files were deleted; the file itself carries one incidental match) and
`backend/.pytest_cache/*` (gitignored, untracked). Neither is a dependency.

---

## 4. Environment variables

**Remove now: none.** Requirement 5 asked for removal "only after confirming they
are no longer required", and each variable still has a reader:

| Variable | Verdict | Reader |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **required** (legacy avatars only) | `isOwnSupabaseStorageUrl`, `scripts/migrate-avatars-to-cloudinary.mjs` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | rollback-only | `src/lib/supabase/{middleware,server}.ts` (unreferenced) |
| `SUPABASE_JWT_SECRET` (frontend) | rollback-only | backend `AUTH_PROVIDER=supabase-legacy` only |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`, `SUPABASE_JWT_ALGORITHMS`, `SUPABASE_JWT_ISSUER`, `SUPABASE_JWT_AUDIENCE` (backend) | rollback-only | `backend/app/core/config.py` + `security.py`, only when that provider is selected |

All six rollback variables now carry that label in both `.env.example` files, and
the block that previously said "Supabase is STILL a dependency for Storage and
Realtime" has been rewritten — a deployment can no longer read those files and
conclude that Supabase serves traffic.

**Variables to delete later, in order:**
1. when the avatar migration is verified → `NEXT_PUBLIC_SUPABASE_URL`, plus the
   `*.supabase.co` entries in `next.config.ts` (CSP **and** `images.remotePatterns`)
   and the `isOwnSupabaseStorageUrl` branch;
2. when the auth rollback window closes (the §9 conditions) → the six
   rollback variables, `@supabase/ssr`, and the four retained files.

---

## 5. Verification (real commands, real exit statuses)

| Gate | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | **exit 0**, 0 errors |
| Frontend lint | `npm run lint` | **exit 0** |
| Frontend tests | `npm test` | **exit 0** — `# tests 709 / # pass 709 / # fail 0` (175 suites) |
| Production build | `npm run build` | **exit 0** — route table rendered, `/api/chat/ws-ticket` and `/api/avatar/upload` present, `ƒ Middleware 75 kB` |
| Backend tests | `cd backend && .venv/bin/python -m pytest -q` | **exit 0** — `489 passed` |
| Backend lint | `cd backend && .venv/bin/python -m ruff check app tests` | **exit 0** — "All checks passed!" |
| Backend dependency audit | `.venv/bin/pip-audit -r backend/requirements.lock.txt` | **exit 0** — "No known vulnerabilities found" |
| Dependency audit | `npm audit` | **exit 1** — 10 advisories (2 moderate, 8 high, **0 critical**); the pre-existing ASA-DEPS-001 residual, unchanged by this phase (they are build-time `postcss`/`glob` chains, not runtime) |
| Bundle check | `grep -ril supabase .next/static .next/server` | matches are **only** `isOwnSupabaseStorageUrl` (legacy avatar validation, reading `NEXT_PUBLIC_SUPABASE_URL`) and `@supabase/auth-js` strings inside the **`@neondatabase/auth`** bundle. No Supabase SDK client, no Supabase origin |
| Edge bundle check | `grep -ril supabase .next/server/middleware.js .next/server/edge-chunks` | no matches — the rollback set is not in the auth path |

**Consolidated run, after the Phase 4 commit — the repository's own runner**
(`node scripts/audit-gates.mjs`, which executes exactly the gates above plus both
audits):

```
[pass] nextjs-typecheck (exit 0)
[pass] nextjs-lint (exit 0)
[pass] nextjs-tests (exit 0)
[pass] nextjs-build (exit 0)
[reviewed] nextjs-npm-audit (exit 1)
[pass] backend-pytest (exit 0) — 489 passed in 3.26s
[pass] backend-ruff (exit 0) — All checks passed!
[pass] backend-pip-audit (exit 0) — No known vulnerabilities found

GATES: all hard gates passed (8 gates run).
```

The npm-audit line is the one gate the runner deliberately scores as `reviewed`
rather than pass/fail (`.audit/validation-report.json`, ASA-DEPS-001): the
advisories are pre-existing and none is critical, and Phase 4 neither introduced
nor removed any (the removed packages had no advisories).

**Sandbox caveats (stated rather than hidden):** `binaries.prisma.sh` is
unreachable here, so the build gate ran with the repository's own engine-stub
mechanism (`scripts/audit-gates.mjs` does the same), and `prisma generate` was
run with stub engine variables before `tsc`. No live Supabase/Cloudinary/Neon
access exists in this environment, so nothing in category B or the avatar
migration was executed against production data — see §7.

`ruff format --check` reports 8 files that "would be reformatted"
(`app/api/v1/endpoints/chat.py`, `app/core/{config,identity}.py`,
`app/services/chat_realtime.py` and 4 test modules). That is **pre-existing**
drift from Phases 3/7/8, it is not a repository gate (`audit-gates.mjs` runs
`ruff check`), and none of those files is touched by Phase 4 — fixing it would
add unrelated churn to this commit.

---

## 6. Requirement-by-requirement

1. **Audit** — done repo-wide; results in §3.
2. **Active vs historical distinguished** — §3 A–E separates them explicitly.
3. **Auth/Realtime removal only where unused** — the two dead modules and
   `@supabase/supabase-js` went; the rollback set and every live path
   (Neon Auth, Neon PostgreSQL, Cloudinary avatars, FastAPI WS + Redis) stayed.
4. **Packages + lockfile** — `@supabase/supabase-js`, `socket.io-client` and 16
   transitive packages removed; `package-lock.json` regenerated with `npm`.
5. **Env files/docs** — obsolete *claims* removed, obsolete *variables* retained
   with corrected labels because each still has a reader (§4). Removing them now
   would break the rollback the brief asks to preserve.
6. **Legacy avatar URLs preserved** — validator, `next/image` allowlist, CSP
   `img-src` and `NEXT_PUBLIC_SUPABASE_URL` all deliberately kept; the avatar
   upload route still refuses to delete a Supabase-hosted avatar.
7. **No production data deleted** — no bucket, table, row or migration file was
   touched; only application source, dependencies and prose changed.
8. **Chat still Neon + HTTP as source of truth** — `chat-service.ts` writes and
   reads messages exclusively through Prisma (`prisma.message.*`, `prisma.chat.*`);
   `publishChatEvent()` is a fire-and-forget notification that is dropped when
   Redis is down; the backend hub subscribes/fans out and stores nothing; history
   still comes from the HTTP API (`useChatSocket` only mirrors live events onto
   already-loaded rows). Redis carries tickets, presence, typing and pub/sub —
   never message bodies.
9. **Gates** — §5, all green.
10. **Re-scan** — §3 lists every remaining reference with its reason.

---

## 7. Production steps still required (Phase 4 does not close these)

1. **Run the avatar migration** — `node scripts/migrate-avatars-to-cloudinary.mjs`
   (start with `--dry-run`, then a `--limit` batch) against production, with
   `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` and the Cloudinary keys set. It
   downloads legacy avatars, re-uploads with deterministic ids and records an
   old→new map in `data/avatar-url-map.json`. **It never deletes Supabase
   objects.**
2. **Verify the migration** — spot-check profiles in both dashboards, confirm no
   `Profile.avatarUrl` still matches `/storage/v1/object/public/avatars/`, and
   watch the map file for failures (`exit code = failure count`).
3. **Only then remove the legacy branches** — `isOwnSupabaseStorageUrl`, the
   `*.supabase.co` CSP/`remotePatterns` entries, and `NEXT_PUBLIC_SUPABASE_URL`.
4. **Freeze the Supabase bucket (manual, after verification)** — production data
   deletion is out of scope here; take a final export, keep the bucket read-only
   for a rollback window, and only then delete objects.
5. **Decide the auth rollback window** — once `docs/auth/MIGRATION.md` §9's
   conditions hold (stable cutover, migration complete, backend no longer needing
   `SUPABASE_JWT_SECRET`), the four retained frontend files, `@supabase/ssr`, the
   rollback env variables and the backend's `supabase-legacy` verifier can all go
   in one follow-up phase.
6. **Deployment checks that Phase 4 cannot perform from here** — that the FastAPI
   host keeps WebSockets open (long-lived worker), that Redis is the shared
   Upstash instance, and that the CSP change from §1 causes no console
   regression in the browser (none is expected: no Supabase origin is used any
   more).

## 8. Rolling Phase 4 back

Phase 4 is a single commit, so `git revert` restores both deleted modules,
`@supabase/supabase-js`, `socket.io-client` and the two CSP origins. Nothing in
the commit is a prerequisite for another phase, and no data or DDL is involved.
