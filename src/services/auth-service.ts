import "server-only";
import { prisma } from "@/lib/prisma";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { SupabaseIdentityUser } from "@/services/account-provisioning";
import {
  AuthServiceError,
  authIdentityFromSupabaseUser,
  dashboardFor,
  decideProfileRole,
  ensureApplicationAccount as ensureApplicationAccountInDb,
  getApplicationAccountState as readAccountStateFromDb,
  saveCompletedProfile,
  type AccountLookupResult,
  type ApplicationAccountState,
  type AuthIdentity,
} from "@/services/account-provisioning";
import {
  AUTH_USER_MESSAGES,
  AuthError,
  classifyPrismaError,
  classifySessionRefreshError,
  classifySupabaseAdminError,
  type AuthErrorCode,
  type AuthErrorDetail,
  type AuthStep,
} from "@/services/auth-errors";
import {
  AUTH_EVENTS,
  createAuthLog,
  type AuthLog,
  type AuthOperation,
} from "@/services/auth-logging";
import type { CompleteProfileInput } from "@/lib/validations/auth";

// Re-exported so callers (Server Actions, route handlers, pages) import the
// auth plumbing from one home. `AuthError` + its codes are the canonical
// authentication error model; `AuthServiceError` is the separate
// user-accountable business error (phone already claimed, …).
export { AuthError, AuthServiceError, authIdentityFromSupabaseUser, dashboardFor, decideProfileRole };
export type { AuthErrorCode, AuthErrorDetail, AuthStep };
export type { AccountLookupResult, ApplicationAccountState, AuthIdentity, SupabaseIdentityUser };

/** The cookie-backed, per-request client that owns the user's session. */
type UserSessionClient = {
  auth: {
    /**
     * The failure payload is typed `unknown` deliberately: the Supabase SDK
     * reports its own error objects, and this boundary only cares that
     * *some* failure exists (it is classified by
     * `classifySessionRefreshError`, which accepts `unknown`).
     */
    refreshSession(): Promise<{
      data: { session: unknown; user: unknown };
      error: unknown;
    }>;
  };
};

/** Derives a log operation label from a free-form context string. */
function operationForContext(context: string): AuthOperation {
  if (context.includes("sign-up")) return "sign-up";
  if (context.includes("callback")) return "auth-callback";
  if (context.includes("profile")) return "profile-completion";
  return "sign-in";
}

/* ── Classification at the Neon boundary ───────────────────────────────────
 * Raw Prisma errors are interpreted HERE (and nowhere else) via
 * `classifyPrismaError`: P1xxx connection-class failures become
 * DATABASE_UNAVAILABLE, request-class failures keep the operation-specific
 * code. A database failure is never converted into `onboarded: false` — it
 * is always an exception the caller fails closed on.
 */

function neonFailure(error: unknown, fallbackCode: AuthErrorCode): AuthError {
  return classifyPrismaError(error, fallbackCode);
}

/**
 * Neon is scale-to-zero (and Render is): the first query after idle can hit
 * a connection-class failure (P1001 timeout / P1002 unreachable) even though
 * the database is otherwise healthy. One bounded retry turns an otherwise
 * healthy login from a failure into a success; a second failure is a real
 * outage and propagates for classification.
 */
export const NEON_RETRY_DELAY_MS = 300;

async function withNeonConnectionRetry<T>(
  log: AuthLog,
  fn: () => Promise<T>,
  delayMs: number = NEON_RETRY_DELAY_MS,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const info =
      typeof error === "object" && error !== null
        ? (error as { code?: unknown }).code
        : undefined;
    const isConnectionClass = typeof info === "string" && info.startsWith("P1");
    if (!isConnectionClass) throw error;
    // The database is cold (Neon scale-to-zero) or a connection dropped.
    // Retry once and record the cold start on the SAME correlation id, so an
    // operator can distinguish "self-healed" from "outage" without scraping
    // raw Prisma stack traces.
    log.success(AUTH_EVENTS.NEON_RETRY, {
      prismaCode: typeof info === "string" ? info : null,
    });
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return await fn();
  }
}

/* ── The canonical boundaries (one implementation each) ─────────────────── */

/**
 * The ONE authoritative provisioning boundary. Idempotent, transaction-safe,
 * server-only. Used by registration, login, OAuth callback and profile
 * completion — never reimplemented elsewhere.
 *
 * Returns the canonical Neon application state (rows exist after this call).
 * Throws:
 *  - `AuthServiceError` — user-accountable (identity without an email);
 *  - `AuthError` — `DATABASE_UNAVAILABLE` or `ACCOUNT_PROVISIONING_FAILED`.
 */
export async function ensureApplicationAccount(
  supabaseUser: SupabaseIdentityUser,
  context: string,
  log?: AuthLog,
  retryDelayMs: number = NEON_RETRY_DELAY_MS,
): Promise<ApplicationAccountState> {
  const identity = authIdentityFromSupabaseUser(supabaseUser);
  const authLog = log ?? createAuthLog(operationForContext(context), supabaseUser.id);

  authLog.success(AUTH_EVENTS.ACCOUNT_PROVISION_START, { context });
  try {
    const state = await withNeonConnectionRetry(
      authLog,
      () => ensureApplicationAccountInDb(prisma, identity),
      retryDelayMs,
    );
    authLog.success(AUTH_EVENTS.ACCOUNT_PROVISION_SUCCESS, {
      userId: supabaseUser.id,
      role: state.role,
      onboarded: state.onboarded,
      hasSellerProfile: state.hasSellerProfile,
    });
    return state;
  } catch (error) {
    if (error instanceof AuthServiceError) {
      const classified = new AuthError(
        "ACCOUNT_PROVISIONING_FAILED",
        error.message,
        {
          boundary: "neon",
          detail: { note: "identity-without-email" },
          userMessage: error.message,
        },
      );
      authLog.failure(classified, { userId: supabaseUser.id });
      throw classified;
    }
    const classified = neonFailure(error, "ACCOUNT_PROVISIONING_FAILED");
    authLog.failure(classified, { userId: supabaseUser.id });
    throw classified;
  }
}

/**
 * The ONE canonical account-state read. Queries Neon — never Supabase
 * app_metadata — and distinguishes the conditions that matter:
 *
 *  - `{ status: "EXISTS" }`   the account exists; `state` is authoritative;
 *  - `{ status: "MISSING" }`  the account does not exist (a normal condition
 *                             — provisioning creates it; NOT an error and
 *                             NOT `onboarded: false` by accident);
 *  - throws `AuthError`       `DATABASE_UNAVAILABLE` / `ACCOUNT_LOOKUP_FAILED`
 *                             — the database could not answer. Callers fail
 *                             closed; a lookup failure must never be routed
 *                             as if it were an incomplete account.
 */
export async function getApplicationAccountState(
  userId: string,
  log?: AuthLog,
  retryDelayMs: number = NEON_RETRY_DELAY_MS,
): Promise<AccountLookupResult> {
  const authLog = log ?? createAuthLog("sign-in" as AuthOperation, userId);

  authLog.success(AUTH_EVENTS.ACCOUNT_LOOKUP_START, {});
  try {
    const result = await withNeonConnectionRetry(
      authLog,
      () => readAccountStateFromDb(prisma, userId),
      retryDelayMs,
    );
    authLog.success(AUTH_EVENTS.ACCOUNT_LOOKUP_SUCCESS, {
      status: result.status,
      role: result.state.role,
      onboarded: result.state.onboarded,
      hasSellerProfile: result.state.hasSellerProfile,
    });
    return result;
  } catch (error) {
    const classified = neonFailure(error, "ACCOUNT_LOOKUP_FAILED");
    authLog.failure(classified);
    throw classified;
  }
}

/**
 * The ONE Supabase app_metadata synchronization path.
 *
 *  1. Reads the current app_metadata (service-role `getUserById`) so that
 *     unrelated keys are PRESERVED — the Admin API `PUT` replaces the object
 *     wholesale, so writing only our three keys would clobber anything else.
 *  2. Merges the minimal claims middleware actually needs:
 *     `role`, `onboarded`, `has_seller_profile`.
 *  3. Calls `updateUserById()` and VALIDATES the result (the returned user
 *     must be the one we updated).
 *  4. Returns the canonical Neon state (unchanged — Supabase is a mirror,
 *     never a source).
 *
 * The service-role client is used ONLY here. Failures throw `AuthError`
 * `METADATA_SYNC_FAILED` with the HTTP status/SDK name for diagnostics.
 */
export async function syncApplicationClaims(
  userId: string,
  state: ApplicationAccountState,
  log?: AuthLog,
): Promise<ApplicationAccountState> {
  const authLog = log ?? createAuthLog("metadata-sync", userId);
  authLog.success(AUTH_EVENTS.METADATA_SYNC_START, {});

  let admin;
  try {
    admin = createServiceRoleClient();
  } catch (error) {
    // Missing/misconfigured service-role key: a configuration failure that
    // must be loud and distinct in the logs (a leading suspect for the
    // production "couldn't load your account" failures).
    const classified = new AuthError(
      "METADATA_SYNC_FAILED",
      AUTH_USER_MESSAGES.METADATA_SYNC_FAILED,
      {
        boundary: "supabase-admin",
        detail: { reason: "service-role-key-missing", note: String(error) },
      },
    );
    authLog.failure(classified);
    throw classified;
  }

  const { data: userData, error: readError } = await admin.auth.admin.getUserById(userId);
  if (readError) {
    const classified = classifySupabaseAdminError(readError, "getUserById");
    authLog.failure(classified);
    throw classified;
  }

  const existingMetadata = (userData.user?.app_metadata ?? {}) as Record<string, unknown>;
  const mergedMetadata: Record<string, unknown> = {
    ...existingMetadata,
    role: state.role,
    onboarded: state.onboarded,
    has_seller_profile: state.hasSellerProfile,
  };

  const { data: updatedData, error: writeError } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: mergedMetadata,
  });
  if (writeError) {
    const classified = classifySupabaseAdminError(writeError, "updateUserById");
    authLog.failure(classified);
    throw classified;
  }
  if (!updatedData.user || updatedData.user.id !== userId) {
    const classified = new AuthError("METADATA_SYNC_FAILED", "Metadata sync returned an unexpected result.", {
      boundary: "supabase-admin",
      detail: { note: "admin update result did not include the expected user" },
    });
    authLog.failure(classified);
    throw classified;
  }

  authLog.success(AUTH_EVENTS.METADATA_SYNC_SUCCESS, {
    role: state.role,
    onboarded: state.onboarded,
    hasSellerProfile: state.hasSellerProfile,
  });
  return state;
}

/**
 * The user-facing session refresh boundary — exactly one refresh per auth
 * flow, on the cookie-backed per-request client (NEVER the service-role
 * client). Best-effort by design: a refresh failure is classified, logged,
 * and reported as `false`; it does not throw, because the middleware
 * re-reads LIVE app_metadata on the next request, so a failed refresh cannot
 * create a redirect loop.
 */
export async function refreshUserSession(
  sessionClient: UserSessionClient,
  userId: string,
  log?: AuthLog,
): Promise<boolean> {
  const authLog = log ?? createAuthLog("session-refresh", userId);
  authLog.success(AUTH_EVENTS.SESSION_REFRESH_START, {});
  try {
    const { error } = await sessionClient.auth.refreshSession();
    if (error) {
      throw error;
    }
    authLog.success(AUTH_EVENTS.SESSION_REFRESH_SUCCESS, {});
    return true;
  } catch (error) {
    const classified = classifySessionRefreshError(error);
    authLog.failure(classified);
    return false;
  }
}

/**
 * The shared post-authentication pipeline:
 *
 *   authenticated Supabase user
 *     → ensureApplicationAccount (Neon, idempotent)
 *     → syncApplicationClaims (Supabase Admin mirror)
 *     → refreshUserSession (user-facing client, exactly once)
 *     → canonical state
 *
 * Used by BOTH password sign-in and the OAuth/email callback, so every
 * entry point settles the account the same way. Steps 1–2 throw
 * (`AuthError`) on failure — the caller fails closed. Step 3 is
 * best-effort. Returns the canonical Neon state for routing.
 */
export async function settleAuthenticatedAccount(args: {
  supabaseUser: SupabaseIdentityUser;
  sessionClient: UserSessionClient;
  context: "sign-in" | "auth-callback";
  log?: AuthLog;
  retryDelayMs?: number;
}): Promise<ApplicationAccountState> {
  const { supabaseUser, sessionClient, context, retryDelayMs } = args;
  const authLog = args.log ?? createAuthLog(context, supabaseUser.id);

  authLog.success(AUTH_EVENTS.SUPABASE_SUCCESS, { userId: supabaseUser.id });

  const state = await ensureApplicationAccount(
    supabaseUser,
    context,
    authLog,
    retryDelayMs,
  );

  await syncApplicationClaims(supabaseUser.id, state, authLog);

  await refreshUserSession(sessionClient, supabaseUser.id, authLog);

  return state;
}

/**
 * The whole /complete-profile write, server-side:
 *
 *  1. `saveCompletedProfile` — the Neon transaction (provision + role rules +
 *     profile + Seller row) commits FIRST. It is the source of truth; no
 *     JWT/session update happens before it succeeds.
 *  2. `syncApplicationClaims` — best-effort after commit (a separate system
 *     that can't join the transaction). A failure is classified + logged and
 *     reported via `metadataSynced: false`; it does NOT undo the committed
 *     onboarding. The /complete-profile page re-syncs on the next visit, so
 *     a stale-claims loop is broken deterministically.
 *
 * Returns the committed canonical state so the caller can route from Neon
 * truth, not JWT claims.
 */
export async function completeUserProfile(
  identity: AuthIdentity,
  input: CompleteProfileInput,
  log?: AuthLog,
): Promise<{
  state: ApplicationAccountState;
  wantsToSell: boolean;
  role: import("@prisma/client").UserRole;
  metadataSynced: boolean;
}> {
  const authLog = log ?? createAuthLog("profile-completion", identity.id);

  // 1. The Neon transaction is the source of truth.
  const { state, wantsToSell, role } = await saveCompletedProfile(prisma, identity, input);
  authLog.success(AUTH_EVENTS.PROFILE_COMPLETED, {
    userId: identity.id,
    role,
    wantsToSell,
    hasSellerProfile: state.hasSellerProfile,
  });

  // 2. Mirror the canonical claims into Supabase app_metadata — best-effort,
  //    post-commit.
  let metadataSynced = false;
  try {
    await syncApplicationClaims(identity.id, state, authLog);
    metadataSynced = true;
  } catch (error) {
    const classified =
      error instanceof AuthError ? error : classifySupabaseAdminError(error, "updateUserById");
    authLog.failure(classified, { step: "post-commit-metadata-sync" });
  }

  return { state, wantsToSell, role, metadataSynced };
}

/**
 * Best-effort provisioning for entry points where a Supabase session is
 * established but no authoritative read follows immediately (email
 * sign-up). Failures are classified and logged, never thrown — the
 * authoritative paths (sign-in, OAuth callback, /complete-profile) re-run the
 * same idempotent provisioning and fail closed if Neon is genuinely down.
 */
export async function provisionUserRows(
  user: SupabaseIdentityUser,
  context: string,
): Promise<void> {
  const log = createAuthLog(operationForContext(context), user.id);
  try {
    await ensureApplicationAccount(user, context, log);
  } catch (error) {
    const classified = error instanceof AuthError ? error : neonFailure(error, "ACCOUNT_PROVISIONING_FAILED");
    log.failure(classified, { step: "best-effort-provision" });
  }
}
