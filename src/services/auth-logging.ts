/**
 * Structured authentication logging with a correlation id per operation.
 *
 * Every auth operation (sign-in, sign-up, OAuth callback, profile completion,
 * metadata sync, session refresh) creates ONE log context:
 *
 *   const log = createAuthLog("sign-in");
 *   log.start();                                  // AUTH_START
 *   log.success("AUTH_SUPABASE_SUCCESS", { userId });
 *   log.failure(authError);                       // AUTH_FAILURE + the real cause
 *
 * Server logs therefore identify the EXACT failing boundary:
 *
 *   { event: "AUTH_FAILURE", operation: "sign-in",
 *     correlationId: "…", userId: "…", code: "DATABASE_UNAVAILABLE",
 *     boundary: "neon", errorType: "PrismaClientInitializationError",
 *     errorCode: "P1001", errorMessage: "…" }
 *
 * ── Redaction (requirement: NEVER log credentials) ──────────────────────
 * Only whitelisted, primitive fields are written. `safeFields()` drops any
 * key that looks sensitive (token, password, secret, cookie, key, jwt,
 * authorization, database/url-ish) and any non-primitive value, so even an
 * accidentally-passed `headers` or `session` object cannot leak. User ids
 * (Supabase UUIDs) are safe to include — they are correlation handles, not
 * credentials.
 */

import { AuthError } from "@/services/auth-errors";

const SENSITIVE_KEY =
  /token|password|passwd|secret|cookie|authorization|apikey|api_key|jwt|session|database|dsn|connection|credential/i;

/** Auth operations that flow through the pipeline. */
export type AuthOperation =
  | "sign-in"
  | "sign-up"
  | "google-sign-in"
  | "auth-callback"
  | "profile-completion"
  | "complete-profile-page"
  | "metadata-sync"
  | "session-refresh"
  | "forgot-password"
  | "reset-password";

/** Canonical auth log events (the vocabulary operations emit). */
export const AUTH_EVENTS = {
  START: "AUTH_START",
  SUPABASE_SUCCESS: "AUTH_SUPABASE_SUCCESS",
  ACCOUNT_PROVISION_START: "AUTH_ACCOUNT_PROVISION_START",
  ACCOUNT_PROVISION_SUCCESS: "AUTH_ACCOUNT_PROVISION_SUCCESS",
  ACCOUNT_PROVISION_FAILED: "AUTH_ACCOUNT_PROVISION_FAILED",
  ACCOUNT_LOOKUP_START: "AUTH_ACCOUNT_LOOKUP_START",
  ACCOUNT_LOOKUP_SUCCESS: "AUTH_ACCOUNT_LOOKUP_SUCCESS",
  ACCOUNT_LOOKUP_FAILED: "AUTH_ACCOUNT_LOOKUP_FAILED",
  METADATA_SYNC_START: "AUTH_METADATA_SYNC_START",
  METADATA_SYNC_SUCCESS: "AUTH_METADATA_SYNC_SUCCESS",
  METADATA_SYNC_FAILED: "AUTH_METADATA_SYNC_FAILED",
  SESSION_REFRESH_START: "AUTH_SESSION_REFRESH_START",
  SESSION_REFRESH_SUCCESS: "AUTH_SESSION_REFRESH_SUCCESS",
  SESSION_REFRESH_FAILED: "AUTH_SESSION_REFRESH_FAILED",
  PROFILE_COMPLETED: "AUTH_PROFILE_COMPLETED",
  /** Emitted when a Neon connection-class failure (P1xxx) self-heals on the
   * bounded retry — the signal that the database was cold (scale-to-zero). */
  NEON_RETRY: "AUTH_NEON_CONNECTION_RETRY",
  REDIRECT: "AUTH_REDIRECT",
  FAILURE: "AUTH_FAILURE",
} as const;

export type AuthEvent = (typeof AUTH_EVENTS)[keyof typeof AUTH_EVENTS];

/** Values permitted in a log field. */
type SafeValue = string | number | boolean | null;

function isSafeValue(value: unknown): value is SafeValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

/**
 * Filters a caller-supplied field object down to safe, primitive values.
 * Anything that fails the check is dropped (not replaced with a placeholder)
 * so the log line stays machine-parseable.
 */
export function safeFields(
  fields: Record<string, unknown> | undefined,
): Record<string, SafeValue> {
  const out: Record<string, SafeValue> = {};
  if (!fields) return out;
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE_KEY.test(key)) continue;
    if (!isSafeValue(value)) continue;
    if (typeof value === "string" && value.length > 2000) continue;
    out[key] = value;
  }
  return out;
}

/** Extracts the machine-readable cause from a raw thrown value. */
function errorDiagnostics(error: unknown): Record<string, SafeValue> {
  const out: Record<string, SafeValue> = {};
  if (typeof error === "object" && error !== null) {
    const o = error as Record<string, unknown>;
    if (typeof o.name === "string") out.errorType = o.name;
    if (typeof o.code === "string") out.errorCode = o.code;
    if (typeof o.message === "string" && o.message.length <= 1000) {
      out.errorMessage = o.message;
    }
    if (typeof o.status === "number") out.httpStatus = o.status;
  } else if (typeof error === "string") {
    out.errorMessage = error.slice(0, 1000);
  } else if (error !== undefined) {
    out.errorType = typeof error;
  }
  return out;
}

export interface AuthLog {
  /** Correlation id for this operation — put it on every log line. */
  correlationId: string;
  start(extra?: Record<string, unknown>): void;
  success(event: AuthEvent, extra?: Record<string, unknown>): void;
  /**
   * Emits AUTH_FAILURE with the classification from an `AuthError` (preferred)
   * or the raw error (classified on the fly as INTERNAL_ERROR).
   */
  failure(error: AuthError | unknown, extra?: Record<string, unknown>): void;
}

/**
 * Creates a log context for one auth operation. A fresh correlation id is
 * minted per call so interleaved requests stay separable.
 *
 * Output goes to `console.log` / `console.error` as a single structured
 * object — Render/Node log shippers (and `jq` in the dev terminal) parse it
 * directly. In tests (NODE_ENV=test) output is suppressed unless
 * AUTH_DEBUG=1, so the suite stays readable.
 */
export function createAuthLog(
  operation: AuthOperation,
  userId?: string,
): AuthLog {
  const correlationId =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

  // Quiet in the test suite (node --test does not set NODE_ENV, so also look
  // at npm's lifecycle marker when the suite runs via `npm test`). Set
  // AUTH_DEBUG=1 to see the structured lines while developing.
  const quiet =
    !process.env.AUTH_DEBUG &&
    (process.env.NODE_ENV === "test" ||
      process.env.npm_lifecycle_event === "test");

  function emit(level: "log" | "error", line: Record<string, SafeValue>) {
    if (quiet) return;
    console[level](JSON.stringify(line));
  }

  function base(line: Record<string, SafeValue> & { event: string }): Record<string, SafeValue> {
    // The spread goes first so the explicitly-typed fields (event, operation,
    // correlationId) are not shadowed by an index-signature property of the
    // caller's field object.
    return {
      ...line,
      event: line.event,
      operation,
      correlationId,
      ...(userId ? { userId } : {}),
    };
  }

  return {
    correlationId,
    start(extra) {
      emit("log", base({ event: AUTH_EVENTS.START, ...safeFields(extra) }));
    },
    success(event, extra) {
      emit("log", base({ event, ...safeFields(extra) }));
    },
    failure(error, extra) {
      const fields = safeFields(extra);
      if (error instanceof AuthError) {
        emit("error",
          base({
            event: AUTH_EVENTS.FAILURE,
            code: error.code,
            boundary: error.boundary,
            ...errorDiagnostics(error),
            ...(error.detail.prismaCode ? { prismaCode: error.detail.prismaCode } : {}),
            ...(error.detail.httpStatus !== undefined ? { httpStatus: error.detail.httpStatus } : {}),
            ...(error.detail.sdkName ? { sdkName: error.detail.sdkName } : {}),
            ...(error.detail.reason ? { reason: error.detail.reason } : {}),
            ...(error.detail.step ? { step: error.detail.step } : {}),
            ...(error.detail.note ? { note: error.detail.note } : {}),
            ...fields,
          })
        );
      } else {
        emit("error", base({ event: AUTH_EVENTS.FAILURE, code: "INTERNAL_ERROR", ...errorDiagnostics(error), ...fields }));
      }
    },
  };
}
