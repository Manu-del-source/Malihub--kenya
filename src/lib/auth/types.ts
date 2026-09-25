/**
 * The application-level authentication contract.
 *
 * ─── Why this file exists ──────────────────────────────────────────────────
 * Nothing outside `src/lib/auth/` should need to know that MaliHub uses Neon
 * Auth, or what shape a Better Auth session payload has. These types are the
 * seam: feature code imports `AuthenticatedUser` and calls `requireUser()`,
 * and the provider behind them can change without a second migration touching
 * every dashboard page.
 *
 * ─── The two identities ────────────────────────────────────────────────────
 * MaliHub deliberately keeps them distinct (docs/auth/ARCHITECTURE.md §2):
 *
 *   AuthIdentity   who the auth provider says you are  (`authUserId`)
 *        │         owned by Neon Auth, lives in the `neon_auth` schema
 *        ▼         mapped via `users.auth_user_id`
 *   ApplicationUser  what you are allowed to do here    (`id`)
 *                  owned by MaliHub, lives in `public.users`
 *
 * `authUserId` is the provider's id and is opaque to the application: it is
 * never a foreign key target, never rendered as an account number, and never
 * assumed to be a UUID. `id` is MaliHub's own UUID and is what every other
 * table references.
 */

import type { UserRole } from "@prisma/client";

// ─── Auth-provider identity ────────────────────────────────────────────────

/**
 * Structural subset of the user object Neon Auth returns from `getSession()`.
 *
 * Declared structurally (not imported from the SDK) so this contract — and
 * every module that consumes it — stays independent of the provider package.
 */
export type AuthIdentity = {
  /** The provider's user id. Mapped onto `users.auth_user_id`. */
  authUserId: string;
  email: string;
  /** Display name held by the provider (`user.name`). */
  name: string | null;
  emailVerified: boolean;
  /** Provider-hosted avatar (`user.image`), e.g. a Google profile photo. */
  image: string | null;
  /** Provider session id — used for logging only, never for authorization. */
  sessionId: string | null;
  /** ISO-8601 session expiry, or null when the provider omitted it. */
  expiresAt: string | null;
};

// ─── MaliHub application identity ──────────────────────────────────────────

/**
 * Authoritative application state, read from MaliHub's own Postgres.
 *
 * This — not anything in the session — is what authorization decisions are
 * made from. Neon Auth has no `app_metadata` equivalent and accepts no custom
 * Better Auth plugins, so role/onboarding/seller claims cannot ride along in
 * the session even if we wanted them to.
 */
export type ApplicationAccess = {
  /** MaliHub's own user id (UUID). Every FK in the schema points at this. */
  id: string;
  email: string;
  phone: string | null;
  role: UserRole;
  /** `profiles.onboarded` — the user finished /complete-profile. */
  onboarded: boolean;
  /** A `sellers` row exists for this user. */
  hasSellerProfile: boolean;
  /** Account is not banned. Banned users are denied at the guard layer. */
  isActive: boolean;
  isBanned: boolean;
};

/**
 * An authenticated request: a verified provider session PLUS the application
 * record it maps to.
 *
 * `identity` is always present (that is what "authenticated" means). `user` is
 * `null` in the one legitimate case where the two disagree — a valid Neon Auth
 * session whose identity has no MaliHub row yet, or no longer has one. Callers
 * must handle that explicitly rather than assuming the row exists; see
 * `requireUser()` and test case 19 in docs/auth/ARCHITECTURE.md.
 */
export type AuthenticatedUser = {
  identity: AuthIdentity;
  user: ApplicationAccess | null;
};

/** Roles that may administer MaliHub. */
export const ADMINISTRATOR_ROLES: readonly UserRole[] = ["ADMIN", "SUPER_ADMIN"];

export function isAdministratorRole(role: UserRole | undefined | null): boolean {
  return role !== undefined && role !== null && ADMINISTRATOR_ROLES.includes(role);
}

// ─── Errors ────────────────────────────────────────────────────────────────

/**
 * Why an auth operation failed, in terms the application cares about.
 *
 * Provider error strings are deliberately NOT surfaced to users: they leak
 * implementation detail and read badly. `src/lib/auth/errors.ts` maps both
 * provider messages and transport failures onto these codes plus friendly copy.
 */
export type AuthFailureCode =
  /** The provider rejected the credentials. */
  | "invalid_credentials"
  /** An account with that email already exists. */
  | "email_taken"
  /** The provider requires the email address to be verified first. */
  | "email_not_verified"
  /** The submitted password does not meet the provider's policy. */
  | "weak_password"
  /** A one-time token (reset / verify) is missing, used, or expired. */
  | "invalid_token"
  /**
   * The auth service is throttling this address or IP.
   *
   * Distinct from `unknown` because the person CAN act on it — waiting a minute
   * and retrying works — whereas "something went wrong" tells them nothing and
   * invites a retry loop that extends the throttle.
   */
  | "rate_limited"
  /** MaliHub could not reach the auth service at all. */
  | "auth_unavailable"
  /** MaliHub is missing NEON_AUTH_BASE_URL / NEON_AUTH_COOKIE_SECRET. */
  | "auth_not_configured"
  /**
   * The auth service is reachable but this capability is not switched on for
   * the branch — e.g. verification EMAIL LINKS need a custom email provider in
   * the Neon Console, and the shared provider only offers verification CODES.
   * Distinct from `unknown` because callers can legitimately fall back to
   * another mechanism rather than reporting a failure.
   */
  | "capability_not_enabled"
  /** Authenticated, but the application database could not be read. */
  | "app_database_unavailable"
  /** Authenticated, but no MaliHub user row maps to this identity. */
  | "no_application_user"
  /** The account is banned. */
  | "account_banned"
  /** None of the above. */
  | "unknown";

export type AuthFailure = {
  code: AuthFailureCode;
  /** Safe to show to the person using the app. Never contains a token. */
  message: string;
  /** HTTP status reported by the provider, when there was one. */
  status?: number;
};
