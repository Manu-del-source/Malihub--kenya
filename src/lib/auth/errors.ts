/**
 * Maps Neon Auth / Better Auth failures onto MaliHub's own error contract.
 *
 * ─── Why this exists ───────────────────────────────────────────────────────
 * The previous implementation had a `mapSupabaseError()` that translated
 * Supabase's raw strings into friendly copy. This is the same job for the new
 * provider, and it matters for two reasons:
 *
 *  1. Provider messages are implementation detail. "Invalid email or password"
 *     is fine; "CREDENTIAL_ACCOUNT_NOT_FOUND" is not something to show a person
 *     trying to buy a phone in Eldoret.
 *  2. Callers branch on the *kind* of failure, not on a string. `signInAction`
 *     needs to know "bad credentials" from "we could not reach the auth
 *     service" because the second one must fail closed rather than tell the
 *     user their password was wrong.
 *
 * ─── What the codes actually are ───────────────────────────────────────────
 * Verified against the installed SDK, not guessed. `@neondatabase/auth`
 * normalizes every upstream failure into `{ message, status, statusText, code }`
 * where `code` is one of its own `AuthErrorCode` strings (`invalid_credentials`,
 * `user_already_exists`, `email_not_confirmed`, `weak_password`, …) mapped from
 * Better Auth's `BASE_ERROR_CODES`, and transport failures use the separate
 * `NETWORK_*` family. A few conditions have no dedicated code and can only be
 * recognised from the retained upstream `message` — email verification being
 * disabled on the branch is the important one, so it is matched explicitly.
 */

import type { AuthFailure, AuthFailureCode } from "./types";

/** Shape the SDK hands back on `error`. Structural, so no SDK import. */
export type ProviderError = {
  message?: string | null;
  status?: number | null;
  statusText?: string | null;
  code?: string | null;
};

/**
 * Transport-failure codes emitted by the SDK when MaliHub cannot reach the
 * Auth service at all (bad `NEON_AUTH_BASE_URL`, DNS, TLS, timeout, refusal).
 * These must never be reported to a user as "wrong password".
 */
const NETWORK_ERROR_CODES = new Set([
  "NETWORK_ERROR",
  "NETWORK_DNS",
  "NETWORK_REFUSED",
  "NETWORK_TIMEOUT",
  "NETWORK_TLS",
  "NETWORK_RESET",
  "NETWORK_ABORT",
]);

/** Provider `code` → MaliHub failure code. */
const CODE_MAP: Record<string, AuthFailureCode> = {
  invalid_credentials: "invalid_credentials",
  user_already_exists: "email_taken",
  email_exists: "email_taken",
  email_not_confirmed: "email_not_verified",
  weak_password: "weak_password",
  bad_jwt: "invalid_token",
  invalid_token: "invalid_token",
  session_expired: "invalid_token",
  over_request_rate_limit: "rate_limited",
  over_email_send_rate_limit: "rate_limited",
  rate_limit_exceeded: "rate_limited",
  too_many_requests: "rate_limited",
};

/**
 * Upstream message fragments → MaliHub failure code, for the conditions the
 * SDK folds into a generic `validation_failed` / `feature_not_supported`.
 * Matched case-insensitively as substrings because these strings come from the
 * auth service and are not part of a typed contract.
 */
const MESSAGE_RULES: ReadonlyArray<{ match: string; code: AuthFailureCode }> = [
  // Email verification LINKS are not switched on for this branch (they need a
  // custom email provider in the Neon Console). Typed distinctly so
  // resendVerificationAction can fall back to a verification CODE instead of
  // reporting a failure the user cannot act on.
  { match: "verification email isn't enabled", code: "capability_not_enabled" },
  { match: "verification email is not enabled", code: "capability_not_enabled" },
  { match: "user already exists", code: "email_taken" },
  { match: "invalid email or password", code: "invalid_credentials" },
  { match: "email not verified", code: "email_not_verified" },
  { match: "too many requests", code: "rate_limited" },
  { match: "rate limit", code: "rate_limited" },
  { match: "password too short", code: "weak_password" },
  { match: "password too long", code: "weak_password" },
  { match: "invalid token", code: "invalid_token" },
  { match: "token expired", code: "invalid_token" },
  // The service's own wording for a spent or aged-out password-reset /
  // verification link: "Invalid or expired reset token". Neither fragment above
  // matches it, and without this rule a person who clicked a 16-minute-old link
  // would get generic copy instead of "request a new one".
  { match: "invalid or expired", code: "invalid_token" },
  { match: "reset token", code: "invalid_token" },
  { match: "verification code", code: "invalid_token" },
];

/**
 * User-facing copy. Deliberately preserves the tone of the messages MaliHub
 * already showed, so this migration does not silently rewrite the product's
 * voice around authentication failures.
 */
const USER_MESSAGES: Record<AuthFailureCode, string> = {
  invalid_credentials: "That email or password doesn't look right.",
  email_taken: "An account with that email already exists. Try signing in instead.",
  email_not_verified:
    "Please verify your email before signing in — check your inbox.",
  weak_password: "Choose a longer password (at least 8 characters).",
  invalid_token: "That link has expired or was already used. Please request a new one.",
  rate_limited: "Too many attempts. Please wait a minute and try again.",
  auth_unavailable:
    "We couldn't reach the sign-in service. Please try again in a moment.",
  auth_not_configured:
    "Sign-in is temporarily unavailable. Please contact support.",
  app_database_unavailable:
    "We couldn't load your MaliHub account. Please try again in a moment.",
  no_application_user:
    "We couldn't find your MaliHub account. Please contact support.",
  capability_not_enabled:
    "That option isn't available right now. Please try the alternative, or contact support.",
  account_banned:
    "This account can't sign in. Please contact support if you think that's a mistake.",
  unknown: "Something went wrong. Please try again.",
};

/**
 * True when the failure means MaliHub could not reach (or is not configured
 * for) the auth service. Callers use this to fail closed instead of blaming
 * the person's password.
 */
export function isAuthUnavailable(failure: AuthFailure): boolean {
  return failure.code === "auth_unavailable" || failure.code === "auth_not_configured";
}

/**
 * True when the upstream is telling us email verification links are not
 * enabled on this Neon branch — the signal `resendVerificationAction` uses to
 * fall back to a verification code.
 *
 * Accepts either the raw provider error or an already-normalized
 * {@link AuthFailure}, so callers can test whichever they are holding.
 */
export function isVerificationEmailDisabled(
  error: ProviderError | AuthFailure | null | undefined
): boolean {
  if (!error) return false;
  if ("code" in error && error.code === "capability_not_enabled") return true;
  const message = error.message?.toLowerCase() ?? "";
  return (
    message.includes("verification email isn't enabled") ||
    message.includes("verification email is not enabled")
  );
}

/**
 * Normalizes any provider failure into MaliHub's contract.
 *
 * `fallbackCode` is used when the provider reports something this module has no
 * specific rule for, so each call site can pick the interpretation that is safe
 * for it — a sign-in failure defaults to "wrong password", a token failure to
 * "expired link".
 */
export function toAuthFailure(
  error: ProviderError | null | undefined,
  fallbackCode: AuthFailureCode = "unknown"
): AuthFailure {
  if (!error) {
    return { code: fallbackCode, message: USER_MESSAGES[fallbackCode] };
  }

  const code = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string" ? error.message : "";
  const lowerMessage = message.toLowerCase();
  const status = typeof error.status === "number" ? error.status : undefined;

  if (NETWORK_ERROR_CODES.has(code) || status === 502) {
    return {
      code: "auth_unavailable",
      message: USER_MESSAGES.auth_unavailable,
      status,
    };
  }

  const mapped = CODE_MAP[code];
  if (mapped) {
    return { code: mapped, message: USER_MESSAGES[mapped], status };
  }

  for (const rule of MESSAGE_RULES) {
    if (lowerMessage.includes(rule.match)) {
      return { code: rule.code, message: USER_MESSAGES[rule.code], status };
    }
  }

  return { code: fallbackCode, message: USER_MESSAGES[fallbackCode], status };
}

/**
 * Builds a failure for a condition MaliHub detected itself (not the provider):
 * a missing application row, an unavailable database, a banned account.
 */
export function authFailure(
  code: AuthFailureCode,
  overrideMessage?: string
): AuthFailure {
  return { code, message: overrideMessage ?? USER_MESSAGES[code] };
}
