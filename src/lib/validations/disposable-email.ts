import disposableEmailDomains from "./disposable-email-domains.json";

/**
 * Disposable email detection backed by the community-maintained
 * disposable-email-domains list, refreshed automatically by GitHub Actions.
 * The static list keeps registration checks fast and avoids a network call
 * during signup. It is a strong denylist, not proof an address is deliverable.
 */
const DISPOSABLE_EMAIL_DOMAINS = new Set<string>([
  ...disposableEmailDomains,
  // Keep abuse reports blocked even if upstream removes them temporarily.
  "moblha.com",
]);

/** Returns true when an email uses a known disposable domain. */
export function isDisposableEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1) return false;

  const domain = normalized.slice(at + 1).replace(/\.$/, "");
  return (
    DISPOSABLE_EMAIL_DOMAINS.has(domain) ||
    [...DISPOSABLE_EMAIL_DOMAINS].some((blocked) => domain.endsWith("." + blocked))
  );
}
