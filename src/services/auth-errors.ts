/**
 * Auth error model — ONE failure has ONE clear classification.
 *
 * Every authentication operation in this app (sign-in, sign-up, OAuth
 * callback, profile completion, metadata sync, session refresh) surfaces its
 * failures through this taxonomy instead of free-form strings. The goal is
 * that a production incident is diagnosable from the server logs alone:
 *
 *   AUTH_FAILURE { code: "DATABASE_UNAVAILABLE", errorType:
 *   "PrismaClientInitializationError", errorCode: "P1001", ... }
 *
 * distinguishes "Neon is unreachable" from "Supabase Admin rejected our
 * service-role key" from "the user's password was wrong" — three failures
 * that the pre-audit code all flattened into one generic user message.
 *
 * SECURITY: `detail` may only carry safe diagnostic values (Prisma error
 * codes, HTTP status codes, SDK error names, enum-like reasons). Never put
 * passwords, tokens, cookies, keys, or connection strings in here — the
 * classifier below extracts only those fields, and the logger redacts any
 * field that looks sensitive as a second line of defense.
 *
 * Pure module: no `server-only` import, no Supabase/Prisma imports, so it is
 * importable from tests and (if ever needed) from edge code.
 */

/**
 * Internal classification. One failure = exactly one of these codes.
 * `ACCOUNT_MISSING` is deliberately NOT an error code — a missing Neon
 * account is a normal, recoverable condition (provisioning creates it), so it
 * is a status on the lookup result, not an exception.
 */
export type AuthErrorCode =
  /** Supabase rejected the credential/OTP (bad password, unconfirmed email, rate limit) or Supabase Auth itself was unreachable. `detail.reason` disambiguates for user-facing copy. */
  | "AUTHENTICATION_FAILED"
  /** The Supabase identity was valid but the Neon rows could not be created/repaired (constraint conflict, write error, …). */
  | "ACCOUNT_PROVISIONING_FAILED"
  /** The Neon account state could not be read for a reason other than "the row does not exist" (missing rows are `ACCOUNT_MISSING`, a status — not this). */
  | "ACCOUNT_LOOKUP_FAILED"
  /** Supabase Admin API (service-role) could not update/validate the app_metadata mirror. */
  | "METADATA_SYNC_FAILED"
  /** The user-facing session could not be re-minted/rotated. */
  | "SESSION_REFRESH_FAILED"
  /** Neon connection-level failure (timeout, unreachable, disconnect — Prisma P1xxx). Kept distinct from lookup/provisioning so operators can tell "database is down" from "database answered and said no". */
  | "DATABASE_UNAVAILABLE"
  /** Internal only: a user-supplied redirect target was rejected. Never surfaced as a failure — the caller falls back to a safe destination. */
  | "INVALID_REDIRECT"
  /** Anything that did not match a known boundary error. */
  | "INTERNAL_ERROR";

/** The system boundary that produced the failure — where in the chain to look. */
export type AuthBoundary =
  | "supabase-auth"
  | "neon"
  | "supabase-admin"
  | "session"
  | "unknown";

/**
 * Named sub-steps within an auth operation where a failure can be attributed.
 * Closed union so log analysis can aggregate on it; the vocabulary mirrors
 * the pipeline's operation labels (see `AuthOperation` in auth-logging.ts)
 * plus `sign-out` (the fail-closed session teardown, which is a step, not an
 * operation of its own in that vocabulary).
 */
export type AuthStep =
  | "sign-in"
  | "sign-up"
  | "auth-callback"
  | "profile-completion"
  | "metadata-sync"
  | "session-refresh"
  | "sign-out";

/**
 * Safe, structured diagnostics for one error. All values are primitive and
 * non-sensitive by construction (see module comment).
 */
export interface AuthErrorDetail {
  /** Prisma error code (P1001, P2002, P2025, …) when the error came from Prisma. */
  prismaCode?: string;
  /** Supabase/HTTP status code (401, 404, 429, 500, …) when the error came from a Supabase API. */
  httpStatus?: number;
  /** SDK error class name (e.g. "AuthApiError", "PrismaClientKnownRequestError"). */
  sdkName?: string;
  /** Sub-reason for `AUTHENTICATION_FAILED`: "invalid-credentials" | "email-not-confirmed" | "rate-limited" | "service-unavailable" | "unknown" | "no-session" (other codes may add their own sub-reasons). */
  reason?: string;
  /** The named sub-step of the operation where the failure occurred (see `AuthStep`). */
  step?: AuthStep;
  /** Free-form, already-verified-safe label (e.g. "service-role-key-missing"). */
  note?: string;
}

/**
 * The single internal auth error type. `message` is ALWAYS a safe,
 * user-presentable sentence; machine-readable diagnosis lives in `code`,
 * `boundary`, and `detail` and is written to the server log, never to the UI.
 */
export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly boundary: AuthBoundary;
  readonly detail: AuthErrorDetail;
  /**
   * Optional user-facing override. Defaults to the copy for `code`; set when
   * the situation has its own precise, safe wording (e.g. "your account has
   * no email on file — contact support").
   */
  readonly userMessage?: string;

  constructor(
    code: AuthErrorCode,
    message: string,
    options: { boundary?: AuthBoundary; detail?: AuthErrorDetail; userMessage?: string } = {},
  ) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.boundary = options.boundary ?? "unknown";
    this.detail = options.detail ?? {};
    this.userMessage = options.userMessage;
  }
}

/* ── User-facing copy ────────────────────────────────────────────────────
 * Concise and safe on purpose. Distinct failures get distinct wording so a
 * user can tell "I typed the wrong password" from "the service is down" —
 * but no infrastructure detail (no Prisma codes, no "Neon", no "Supabase
 * Admin", no stack traces) ever reaches the UI.
 */

export const AUTH_USER_MESSAGES: Record<AuthErrorCode, string> = {
  AUTHENTICATION_FAILED:
    "That email or password doesn't look right. Please check and try again.",
  ACCOUNT_PROVISIONING_FAILED:
    "We couldn't prepare your MaliHub account. Please try signing in again in a moment.",
  ACCOUNT_LOOKUP_FAILED:
    "We couldn't load your MaliHub account. Please try signing in again.",
  METADATA_SYNC_FAILED:
    "We couldn't fully load your MaliHub account. Please try signing in again in a moment.",
  SESSION_REFRESH_FAILED:
    "Your session couldn't be refreshed. Please sign in again.",
  DATABASE_UNAVAILABLE:
    "MaliHub's account service is temporarily unavailable. Please try again in a minute.",
  INVALID_REDIRECT: "Please try again.",
  INTERNAL_ERROR:
    "Something went wrong. Please try again, and contact support if it persists.",
};

/** Copy for the `AUTHENTICATION_FAILED` sub-reasons (the one code with two very different user situations). */
export const AUTHENTICATION_REASON_MESSAGES: Record<string, string> = {
  "invalid-credentials": "That email or password doesn't look right.",
  "email-not-confirmed":
    "Please verify your email before signing in — check your inbox.",
  "rate-limited": "Too many attempts. Please wait a moment and try again.",
  "service-unavailable":
    "Sign-in is temporarily unavailable. Please try again in a minute.",
};

/**
 * Resolves the user-facing message for an auth failure. `detail.reason`
 * refines `AUTHENTICATION_FAILED` into its four sub-cases; everything else
 * maps one-to-one. Unknown codes fall back to the generic copy rather than
 * leaking an internal string.
 */
export function userFacingMessage(error: AuthError): string {
  if (error.userMessage) return error.userMessage;
  if (error.code === "AUTHENTICATION_FAILED" && error.detail.reason) {
    return (
      AUTHENTICATION_REASON_MESSAGES[error.detail.reason] ??
      AUTH_USER_MESSAGES.AUTHENTICATION_FAILED
    );
  }
  return AUTH_USER_MESSAGES[error.code] ?? AUTH_USER_MESSAGES.INTERNAL_ERROR;
}

/* ── Classification ──────────────────────────────────────────────────────
 * Map a raw thrown value (Prisma error, Supabase AuthError, network failure,
 * anything) to exactly one AuthError. The classifier is the ONLY place where
 * raw errors are interpreted — callers must not re-inspect the raw error.
 */

interface RawErrorInfo {
  name?: string;
  message?: string;
  code?: string;
  status?: number;
}

function rawInfo(error: unknown): RawErrorInfo {
  if (typeof error === "object" && error !== null) {
    const o = error as Record<string, unknown>;
    return {
      name: typeof o.name === "string" ? o.name : undefined,
      message: typeof o.message === "string" ? o.message : undefined,
      code: typeof o.code === "string" ? o.code : undefined,
      status: typeof o.status === "number" ? o.status : undefined,
    };
  }
  if (typeof error === "string") return { message: error };
  return {};
}

/**
 * Prisma's client errors carry a stable `code`:
 *  - `P1xxx` — connection/initialization class (P1001 request timeout,
 *    P1002 can't reach, P1008 connection closed, …) → the database itself is
 *    unavailable.
 *  - `P2xxx` — the database answered with a request-level error (P2002 unique
 *    constraint, P2025 record not found, P2022 column/field mismatch, …).
 * Unknown shapes are not treated as Prisma errors.
 */
export function classifyPrismaError(
  error: unknown,
  fallbackCode: AuthErrorCode,
): AuthError {
  const info = rawInfo(error);
  const message = info.message ?? String(error);

  if (info.code && info.code.startsWith("P1")) {
    return new AuthError("DATABASE_UNAVAILABLE", AUTH_USER_MESSAGES.DATABASE_UNAVAILABLE, {
      boundary: "neon",
      detail: { prismaCode: info.code, sdkName: info.name, note: message },
    });
  }

  const code =
    info.code && info.code.startsWith("P2") ? fallbackCode : "INTERNAL_ERROR";
  return new AuthError(code, userFacingFor(code), {
    boundary: "neon",
    detail: { prismaCode: info.code, sdkName: info.name, note: message },
  });
}

function userFacingFor(code: AuthErrorCode): string {
  return AUTH_USER_MESSAGES[code] ?? AUTH_USER_MESSAGES.INTERNAL_ERROR;
}

/**
 * Supabase `signInWithPassword`/`signInWithOAuth`-style errors.
 * supabase-js raises `AuthApiError` (has numeric `status`) and
 * `AuthRetryableFetchException` (network-level; no status). We classify by
 * status first, then by the well-known message strings GoTrue returns, then
 * by shape.
 */
export function classifySupabaseAuthError(
  error: unknown,
  operation: "sign-in" | "sign-up" | "oauth-exchange" | "password-reset",
): AuthError {
  const info = rawInfo(error);
  const message = info.message ?? "";

  // Network-level failure: no HTTP status at all. This is "authentication
  // service unavailable", NOT "invalid credentials".
  if (info.status === undefined) {
    return new AuthError("AUTHENTICATION_FAILED", AUTH_USER_MESSAGES.AUTHENTICATION_FAILED, {
      boundary: "supabase-auth",
      detail: {
        reason: "service-unavailable",
        sdkName: info.name,
        note: `operation=${operation} ${message}`.trim(),
      },
    });
  }

  if (info.status === 429) {
    return new AuthError("AUTHENTICATION_FAILED", AUTH_USER_MESSAGES.AUTHENTICATION_FAILED, {
      boundary: "supabase-auth",
      detail: { reason: "rate-limited", httpStatus: info.status, sdkName: info.name },
    });
  }

  if (info.status >= 500) {
    return new AuthError("AUTHENTICATION_FAILED", AUTH_USER_MESSAGES.AUTHENTICATION_FAILED, {
      boundary: "supabase-auth",
      detail: {
        reason: "service-unavailable",
        httpStatus: info.status,
        sdkName: info.name,
        note: message,
      },
    });
  }

  // 4xx with a status: Supabase rejected the request. Distinguish the two
  // user-fixable cases from the rest.
  if (message.includes("Email not confirmed")) {
    return new AuthError("AUTHENTICATION_FAILED", AUTH_USER_MESSAGES.AUTHENTICATION_FAILED, {
      boundary: "supabase-auth",
      detail: { reason: "email-not-confirmed", httpStatus: info.status, sdkName: info.name },
    });
  }

  // 400 "Invalid login credentials", 401, 403, 404 (unknown user for
  // password reset), … all collapse to "invalid credentials" for the user —
  // and must NOT leak which half failed (account enumeration).
  return new AuthError("AUTHENTICATION_FAILED", AUTH_USER_MESSAGES.AUTHENTICATION_FAILED, {
    boundary: "supabase-auth",
    detail: { reason: "invalid-credentials", httpStatus: info.status, sdkName: info.name },
  });
}

/**
 * Supabase Admin API (service-role) errors — app_metadata reads/writes.
 * Any failure here is `METADATA_SYNC_FAILED`: the user was authenticated and
 * (usually) the Neon state is known, but the JWT cache could not be
 * established, and the caller must fail closed rather than route on stale
 * claims.
 */
export function classifySupabaseAdminError(
  error: unknown,
  operation: "getUserById" | "updateUserById",
): AuthError {
  const info = rawInfo(error);
  return new AuthError("METADATA_SYNC_FAILED", AUTH_USER_MESSAGES.METADATA_SYNC_FAILED, {
    boundary: "supabase-admin",
    detail: {
      httpStatus: info.status,
      sdkName: info.name,
      note: `operation=${operation} ${info.message ?? ""}`.trim(),
    },
  });
}

/**
 * `refreshSession()` failures on the user-facing client. Defined behavior:
 * non-fatal for sign-in (the middleware re-reads live claims on the next
 * request), but must be classified and logged — never swallowed silently.
 */
export function classifySessionRefreshError(error: unknown): AuthError {
  const info = rawInfo(error);
  return new AuthError(
    "SESSION_REFRESH_FAILED",
    AUTH_USER_MESSAGES.SESSION_REFRESH_FAILED,
    {
      boundary: "session",
      detail: {
        reason: info.status === undefined ? "network" : "rejected",
        httpStatus: info.status,
        sdkName: info.name,
        note: info.message,
      },
    },
  );
}

/**
 * Last-resort classifier for an unexpected value that escaped the
 * boundary-specific classifiers. Always `INTERNAL_ERROR`; the raw message is
 * kept for the log (it is server-side only).
 */
export function classifyUnknownError(error: unknown): AuthError {
  const info = rawInfo(error);
  return new AuthError("INTERNAL_ERROR", AUTH_USER_MESSAGES.INTERNAL_ERROR, {
    detail: { sdkName: info.name, note: info.message ?? String(error) },
  });
}
