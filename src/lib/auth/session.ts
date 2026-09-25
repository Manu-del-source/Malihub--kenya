import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { LOGIN_PATH } from "@/lib/auth/config";
import { authFailure, isAuthUnavailable } from "@/lib/auth/errors";
import { readAccessForSession } from "@/lib/auth/identity";
import { readAuthSession } from "@/lib/auth/neon";
import {
  isAdministratorRole,
  type ApplicationAccess,
  type AuthFailure,
  type AuthenticatedUser,
  type AuthIdentity,
} from "@/lib/auth/types";
import type { UserRole } from "@prisma/client";

/**
 * Server-side session and authorization guards.
 *
 * ─── The rule this module enforces ─────────────────────────────────────────
 * **Authentication** comes from Neon Auth. **Authorization** comes from
 * MaliHub's own database. Never the other way round, and never both from the
 * same place.
 *
 * The previous implementation read `role`, `onboarded` and `has_seller_profile`
 * out of the provider's `app_metadata` JWT claim — including in middleware, on
 * every request. That is gone. Neon Auth has no equivalent (it accepts no custom
 * Better Auth plugins and exposes no arbitrary claims), and rebuilding a signed
 * claim cache would only recreate the same staleness problem that produced the
 * original redirect-loop bugs. So:
 *
 *   middleware  → "is there a valid Neon Auth session?"      (no DB query)
 *   this module → "what is this account allowed to do?"      (authoritative
 *                                                          Prisma read)
 *
 * ─── Request-scoped memoization ────────────────────────────────────────────
 * A single render can pass through a layout, a page and several Server Actions,
 * each of which wants the current user. `React.cache()` collapses those into
 * one session read and one authorization read per request. Without it the
 * dashboard layout would cost a round trip per component.
 */

export type AuthContext = {
  /** The verified provider identity, or null when unauthenticated. */
  identity: AuthIdentity | null;
  /** Authoritative MaliHub state, or null when unauthenticated/unmapped. */
  user: ApplicationAccess | null;
  /**
   * Set when authentication could not be *established* (as opposed to "there is
   * no session"). Callers use this to avoid telling someone their password was
   * wrong when the real problem is that MaliHub could not reach the auth
   * service or its own database.
   */
  failure: AuthFailure | null;
};

const NO_AUTH: AuthContext = { identity: null, user: null, failure: null };

/**
 * Resolves the current request's authentication AND authorization state.
 * Never throws and never redirects — this is the read the guards are built on,
 * and it is safe to call from a component that renders differently for signed-in
 * and signed-out visitors.
 *
 * Failure modes are kept distinct on purpose:
 *  - no session at all                → `{ identity: null, failure: null }`
 *  - auth service unreachable         → `failure.code === "auth_unavailable"`
 *  - Neon Auth not configured         → `failure.code === "auth_not_configured"`
 *  - session valid, no MaliHub row    → `identity` set, `user === null`
 *  - session valid, database down     → `identity` set, `failure.code ===
 *                                       "app_database_unavailable"`
 *
 * The last two are the ones a naive implementation collapses into "not signed
 * in", which would send a paying customer with a valid session to the login
 * page during a database blip — or, worse, treat a database outage as proof
 * that somebody is not an admin.
 */
export const getAuthContext = cache(async (): Promise<AuthContext> => {
  const { identity, failure } = await readAuthSession();

  if (!identity) {
    return failure ? { identity: null, user: null, failure } : NO_AUTH;
  }

  try {
    const access = await readAccessForSession(identity);

    if (!access) {
      // Authenticated by Neon Auth, but no MaliHub account maps to this
      // identity. Reported distinctly so callers can repair or explain rather
      // than silently treating the person as a stranger.
      return { identity, user: null, failure: authFailure("no_application_user") };
    }

    return {
      identity,
      user: {
        id: access.id,
        email: access.email,
        phone: access.phone,
        role: access.role,
        onboarded: access.onboarded,
        hasSellerProfile: access.hasSellerProfile,
        isActive: access.isActive,
        isBanned: access.isBanned,
      },
      failure: null,
    };
  } catch (error) {
    // The application database could not be read. Authentication succeeded, so
    // this is NOT "signed out" — and it must not be read as "no privileges"
    // either, because a guard that treats it that way would let an outage
    // downgrade an admin instead of failing closed.
    console.error("Failed to read MaliHub application state for an authenticated session", {
      // The provider's user id is safe to log; it is not a credential.
      authUserId: identity.authUserId,
      sessionId: identity.sessionId,
      error: error instanceof Error ? error.name : typeof error,
    });
    return { identity, user: null, failure: authFailure("app_database_unavailable") };
  }
});

/** The current user, or `null`. Never throws. */
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const context = await getAuthContext();
  if (!context.identity) return null;
  return { identity: context.identity, user: context.user };
}

/** True when there is a verified session, regardless of application state. */
export async function isAuthenticated(): Promise<boolean> {
  const context = await getAuthContext();
  return context.identity !== null;
}

/**
 * For Server Actions that return an `ApiResult` instead of redirecting.
 *
 * Actions must not call `redirect()` for an auth failure: the caller is a form
 * that expects a JSON-ish result and shows a toast. This hands back the same
 * distinction the guards use — "not signed in" versus "we could not tell" —
 * with user-safe copy already attached.
 */
export type ActionAuth =
  | { ok: true; identity: AuthIdentity; user: ApplicationAccess }
  | { ok: false; error: string; failure: AuthFailure };

/**
 * Requires only a verified provider IDENTITY — no application row yet.
 *
 * This exists for exactly one flow: /complete-profile. A brand-new account can
 * legitimately reach it before its `users`/`profiles` rows exist (sign-up
 * provisioning is best-effort by design), and the profile write provisions them
 * authoritatively inside its own transaction. Requiring a mapped user here would
 * make first-time onboarding impossible.
 *
 * Everything else should use {@link requireActionUser}.
 */
export type ActionIdentity =
  | { ok: true; identity: AuthIdentity }
  | { ok: false; error: string; failure: AuthFailure };

export async function requireActionIdentity(): Promise<ActionIdentity> {
  const context = await getAuthContext();

  if (!context.identity) {
    const failure = context.failure ?? authFailure("unknown");
    return {
      ok: false,
      error: isAuthUnavailable(failure)
        ? failure.message
        : "Your session has expired. Please sign in again.",
      failure,
    };
  }

  // An authenticated identity whose application row could not be read is still
  // allowed to complete its profile — unless the database itself is down, in
  // which case the provisioning write would fail too and the honest answer is
  // "try again", not "your account is broken".
  if (context.failure?.code === "app_database_unavailable") {
    return { ok: false, error: context.failure.message, failure: context.failure };
  }

  if (context.user?.isBanned) {
    const failure = authFailure("account_banned");
    return { ok: false, error: failure.message, failure };
  }

  return { ok: true, identity: context.identity };
}

/**
 * Requires a fully usable account: authenticated, mapped to a MaliHub user, and
 * not banned.
 *
 * Onboarding is NOT required here — several legitimate flows (completing a
 * profile, resetting a password) run before onboarding finishes. Use
 * {@link requireOnboardedActionUser} for dashboard actions.
 */
export async function requireActionUser(): Promise<ActionAuth> {
  const context = await getAuthContext();

  if (!context.identity) {
    const failure = context.failure ?? authFailure("unknown");
    return {
      ok: false,
      error: isAuthUnavailable(failure)
        ? failure.message
        : "Your session has expired. Please sign in again.",
      failure,
    };
  }

  if (!context.user) {
    const failure = context.failure ?? authFailure("no_application_user");
    return { ok: false, error: failure.message, failure };
  }

  if (context.user.isBanned || !context.user.isActive) {
    const failure = authFailure("account_banned");
    return { ok: false, error: failure.message, failure };
  }

  return { ok: true, identity: context.identity, user: context.user };
}

/** {@link requireActionUser} plus `profiles.onboarded === true`. */
export async function requireOnboardedActionUser(): Promise<ActionAuth> {
  const result = await requireActionUser();
  if (!result.ok) return result;

  if (!result.user.onboarded) {
    return {
      ok: false,
      error: "Please finish setting up your profile first.",
      failure: authFailure("unknown", "Please finish setting up your profile first."),
    };
  }

  return result;
}

// ─── Redirecting guards (Server Components, layouts, pages) ────────────────

/**
 * Requires an authenticated, mapped, non-banned account — or redirects.
 *
 * `redirect()` throws by design in Next.js, so call sites need no null check
 * after this returns.
 *
 * Note on `redirectTo`: this guard redirects to `/login` WITHOUT a
 * `redirectTo` parameter. That is intentional. Middleware already bounced
 * unauthenticated visitors away from protected routes *with* a `redirectTo`, so
 * reaching this branch means the session was lost mid-render or the route is
 * not middleware-protected — and there is no reliable way to read the current
 * pathname from a Server Component in the App Router. Inventing one from the
 * `referer` header would be a guess, and a wrong guess here is an open-redirect
 * risk. The cost is that this rare path loses the return destination.
 */
export async function requireUser(): Promise<AuthenticatedUser & { user: ApplicationAccess }> {
  const context = await getAuthContext();

  if (!context.identity) {
    redirect(LOGIN_PATH);
  }

  if (context.user?.isBanned || (context.user && !context.user.isActive)) {
    // Not a redirect to /login — the account exists and is authenticated, it is
    // just not allowed in. Looping it back to the login form would be both
    // confusing and a way to probe which accounts are banned.
    redirect("/");
  }

  if (!context.user) {
    // Authenticated with no application row. /complete-profile provisions
    // authoritatively inside its own transaction, so sending the person there
    // is a repair path rather than a dead end.
    redirect("/complete-profile");
  }

  return { identity: context.identity, user: context.user };
}

/** Requires a fully onboarded account, sending incomplete ones to finish setup. */
export async function requireOnboardedUser(): Promise<
  AuthenticatedUser & { user: ApplicationAccess }
> {
  const current = await requireUser();

  if (!current.user.onboarded) {
    redirect("/complete-profile");
  }

  return current;
}

/**
 * Requires one of `roles`. This is the authoritative admin check.
 *
 * Middleware can no longer perform it: role is application state, and Neon Auth
 * carries no role claim. Doing it here means the check reads the same database
 * row that the admin UI writes, so a role change takes effect on the next
 * request with no JWT to re-mint and no cache to invalidate.
 */
export async function requireRole(
  roles: readonly UserRole[]
): Promise<AuthenticatedUser & { user: ApplicationAccess }> {
  const current = await requireOnboardedUser();

  if (!roles.includes(current.user.role)) {
    redirect("/dashboard/buyer");
  }

  return current;
}

/** Requires ADMIN or SUPER_ADMIN. */
export async function requireAdministrator(): Promise<
  AuthenticatedUser & { user: ApplicationAccess }
> {
  const current = await requireOnboardedUser();

  if (!isAdministratorRole(current.user.role)) {
    redirect("/");
  }

  return current;
}

/**
 * Requires seller-dashboard access: an actual `sellers` row, or an
 * administrator (admins may view seller screens for support).
 *
 * Access is based on the Seller record rather than on `role === "SELLER"`,
 * matching the rule the previous middleware enforced and ARCHITECTURE.md §5a —
 * every role can still buy, and a SELLER-role account whose row was never
 * created must not be shown an empty seller dashboard.
 */
export async function requireSellerAccess(): Promise<
  AuthenticatedUser & { user: ApplicationAccess }
> {
  const current = await requireOnboardedUser();

  if (!current.user.hasSellerProfile && !isAdministratorRole(current.user.role)) {
    redirect("/dashboard/buyer");
  }

  return current;
}
