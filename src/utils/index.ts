import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind classes safely, resolving conflicting utility classes. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format integer cents as a KES currency string, e.g. 150000 -> "KSh 1,500". */
export function formatKes(cents: number): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  })
    .format(cents / 100)
    .replace("KES", "KSh");
}

/** Convert a KES major-unit amount (e.g. from a form) into integer cents. */
export function kesToCents(amount: number): number {
  return Math.round(amount * 100);
}

/** URL-safe slug from a listing title, with a short random suffix to avoid collisions. */
export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base}-${suffix}`;
}

/** Human-friendly relative time, e.g. "3 hours ago". Falls back to a date for older items. */
export function timeAgo(date: Date | string): string {
  const then = new Date(date).getTime();
  const seconds = Math.floor((Date.now() - then) / 1000);

  const ranges: [number, string][] = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [7, "day"],
    [4.345, "week"],
    [12, "month"],
    [Number.POSITIVE_INFINITY, "year"],
  ];

  let unitValue = seconds;
  for (const [limit, unit] of ranges) {
    if (unitValue < limit) {
      const rounded = Math.floor(unitValue);
      return rounded <= 1 ? `just now` : `${rounded} ${unit}${rounded > 1 ? "s" : ""} ago`;
    }
    unitValue /= limit;
  }
  return new Date(date).toLocaleDateString("en-KE");
}

/**
 * Normalize a Kenyan phone number to the 2547XXXXXXXX / 2541XXXXXXXX MSISDN
 * format mobile-money rails expect.
 *
 * Named for the *format*, not for a provider: M-Pesa, Airtel Money and any
 * aggregator in front of them (PayHero today, Daraja directly in future) all
 * want the same E.164-style Kenyan MSISDN, so this helper belongs to none of
 * them. It was `toMpesaMsisdn()` before Phase 8's payment generalization.
 */
export function toKenyanMsisdn(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("254")) return digits;
  if (digits.startsWith("0")) return `254${digits.slice(1)}`;
  if (digits.startsWith("7") || digits.startsWith("1")) return `254${digits}`;
  return digits;
}
