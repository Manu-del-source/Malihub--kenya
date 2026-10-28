/**
 * Disposable email domain guard for account registration.
 *
 * Keep this list curated and extend it when abuse reports identify new
 * providers. This is a denylist, not proof that an address is deliverable.
 */
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "10minutemail.com", "10minutemail.net",
  "guerrillamail.com", "guerrillamail.net", "guerrillamail.org",
  "mailinator.com", "mailinator.net", "mailinator.org",
  "yopmail.com", "yopmail.fr", "tempmail.com", "temp-mail.org",
  "temp-mail.io", "throwawaymail.com", "fakeinbox.com", "getnada.com",
  "emailondeck.com", "maildrop.cc", "dispostable.com", "sharklasers.com",
  "grr.la", "trashmail.com", "trashmail.me", "trashmail.net",
  "mintemail.com", "mohmal.com", "burnermail.io", "mailsac.com",
  "inboxkitten.com", "discard.email", "discardmail.com", "mailnesia.com",
  "tempail.com", "tempr.email", "emailfake.com", "crazymailing.com",
  "harakirimail.com", "jetable.org", "mytemp.email", "tmpmail.org",
  "tmpmail.net", "getairmail.com", "anonbox.net", "spamgourmet.com",
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
