/**
 * MaliHub's authentication interface — the only auth module application code
 * should import.
 *
 * ─── What this buys ────────────────────────────────────────────────────────
 * Roughly twenty-five pages, layouts, Server Actions and Route Handlers need to
 * know "who is signed in, and what may they do?". Before this abstraction each
 * of them constructed a provider client and called `getUser()` directly, which
 * is what made the identity provider a load-bearing dependency of the whole
 * app. They now call `requireUser()` / `requireSellerAccess()` / … and never
 * mention Neon Auth.
 *
 * ─── Do NOT import this from middleware ────────────────────────────────────
 * This barrel re-exports `./session` and `./identity`, which are `server-only`
 * and pull in Prisma. Neither belongs in the edge runtime. `src/middleware.ts`
 * imports the three edge-safe modules directly instead:
 *
 *   `@/lib/auth/config`    env resolution + route ownership
 *   `@/lib/auth/redirects` safe-redirect validation
 *   `@/lib/auth/neon`      the SDK's session-validation middleware
 *
 * ─── Rolling back ──────────────────────────────────────────────────────────
 * The previous provider's implementation is retained, unreferenced, under
 * `src/lib/supabase/`. Restoring it is documented step-by-step in
 * docs/auth/MIGRATION.md §8; because application code depends on this module
 * rather than on a provider, that rollback does not require editing feature
 * code.
 */

// ─── Guards: what application code actually uses ───────────────────────────
export {
  getAuthContext,
  getCurrentUser,
  isAuthenticated,
  requireActionUser,
  requireActionIdentity,
  requireOnboardedActionUser,
  requireUser,
  requireOnboardedUser,
  requireRole,
  requireAdministrator,
  requireSellerAccess,
  type AuthContext,
  type ActionAuth,
} from "./session";

// ─── Provider operations: used by the auth Server Actions only ─────────────
export {
  providerSignUp,
  providerSignIn,
  providerSignInWithGoogle,
  providerSignOut,
  providerRequestPasswordReset,
  providerResetPassword,
  providerSendVerificationEmail,
  providerSendVerificationCode,
  providerVerifyEmailWithCode,
  readAuthSession,
  type ProviderResult,
  type SessionResult,
} from "./neon";

// ─── Identity mapping ──────────────────────────────────────────────────────
export {
  authIdentityFromProviderSession,
  provisionApplicationUser,
  readAccessForSession,
  AuthServiceError,
} from "./identity";

// ─── Errors ────────────────────────────────────────────────────────────────
export {
  authFailure,
  isAuthUnavailable,
  isVerificationEmailDisabled,
  toAuthFailure,
  type ProviderError,
} from "./errors";

// ─── Types and configuration ───────────────────────────────────────────────
export {
  ADMINISTRATOR_ROLES,
  isAdministratorRole,
  type ApplicationAccess,
  type AuthFailure,
  type AuthFailureCode,
  type AuthIdentity,
  type AuthenticatedUser,
} from "./types";

export {
  AUTH_ROUTE_PREFIXES,
  LOGIN_PATH,
  PROTECTED_PREFIXES,
  isAuthRoutePath,
  isProtectedPath,
  isNeonAuthConfigured,
  shouldLinkUnmappedAccountsByEmail,
} from "./config";

export { loginUrlWithRedirect, safeInternalRedirect } from "./redirects";
