/**
 * Centralized open-redirect protection. EVERY user-supplied redirect target
 * (login `redirectTo`, OAuth/email-callback `next`, …) must pass through
 * `safeInternalRedirect()` before it is used — there is no second, ad-hoc
 * validator anywhere in the app.
 *
 * Accepted: same-origin absolute paths — `/`, `/dashboard/buyer`,
 * `/dashboard/buyer/orders?status=open`, `/complete-profile#step-2`.
 *
 * Rejected (returns null → caller falls back to its safe default):
 *   - external URLs          https://evil.example
 *   - protocol-relative      //evil.example        (the leading-slash trap)
 *   - backslash forms        \\evil.example        (browsers normalize \ to /)
 *   - other schemes          javascript:alert(1),  data:text/html,…
 *   - control characters     /%00, /tab, /newline  (header/log poisoning)
 *   - non-ASCII              (legitimate internal targets here are ASCII)
 *   - overlong targets       > 2048 chars
 *   - anything else that does not parse as a path on our origin
 *
 * Pure function — no imports, no server-only, unit-testable everywhere.
 */

const MAX_REDIRECT_LENGTH = 2048;

/**
 * A fixed, unregistered origin used only to parse candidate paths. Any
 * candidate that resolves to a different origin is cross-origin and rejected.
 */
const PARSE_ORIGIN = "https://redirect-guard.internal";

export function safeInternalRedirect(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > MAX_REDIRECT_LENGTH) return null;

  // Same-origin absolute path: starts with exactly one slash.
  // `//host` (protocol-relative) and `\\host` (backslash) must fail here —
  // they are the classic bypasses of a naive `startsWith("/")` check.
  if (!value.startsWith("/") || value.startsWith("//")) return null;

  // Backslashes anywhere are a cross-origin normalization trick in some
  // browsers (`/\evil.example` → `//evil.example`); reject outright.
  if (value.includes("\\")) return null;

  // Control characters (NUL, tab, newline, …) can poison logs/headers and
  // are never legitimate in a path we re-emit into a URL or Location header.
  if (/[^\x20-\x7E]/.test(value)) return null;

  // Their percent-encoded forms (%00–%1F, %7F) decode back to the same
  // control characters at the transport layer — reject them too. Legitimate
  // internal routes never contain encoded C0 controls.
  if (/(?:%0[0-9A-Fa-f]|%1[0-9A-Fa-f]|%7F)/.test(value)) return null;

  try {
    const url = new URL(value, PARSE_ORIGIN);
    if (url.origin !== PARSE_ORIGIN) return null;
    const destination = `${url.pathname}${url.search}${url.hash}`;
    return destination.startsWith("/") ? destination : null;
  } catch {
    return null;
  }
}
