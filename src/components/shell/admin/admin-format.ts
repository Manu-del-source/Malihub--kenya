/**
 * Date formatting for admin screens — `timeAgo` for "when was this touched"
 * rows, explicit dates for decision records where precision matters
 * (audit log, account timestamps). Deliberately not `Intl` relative-time
 * machinery: admin needs unambiguous UTC-readable stamps.
 */

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

export function formatDate(date: Date | string): string {
  return DATE.format(new Date(date));
}

export function formatDateTime(date: Date | string): string {
  return `${DATE_TIME.format(new Date(date))} UTC`;
}
