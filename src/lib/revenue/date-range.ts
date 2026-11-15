/**
 * Report date ranges, in Kenya time (EAT, UTC+3, no daylight saving).
 * Ranges are half-open: `from` inclusive, `to` exclusive.
 */
export const REVENUE_PRESETS = [
  { key: "today", label: "Today" },
  { key: "last7", label: "Last 7 days" },
  { key: "last30", label: "Last 30 days" },
  { key: "thisMonth", label: "This month" },
  { key: "previousMonth", label: "Previous month" },
  { key: "custom", label: "Custom range" },
] as const;

export type RevenuePreset = (typeof REVENUE_PRESETS)[number]["key"];

export type RevenueRange = {
  preset: RevenuePreset;
  from: Date;
  to: Date;
  label: string;
  /** Present when a custom range was invalid and a default was used instead. */
  error?: string;
};

const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_CUSTOM_RANGE_DAYS = 366;

/** Midnight (EAT) at the start of the EAT day containing `instant`, as a UTC Date. */
function startOfEatDay(instant: Date): Date {
  const eat = instant.getTime() + EAT_OFFSET_MS;
  return new Date(Math.floor(eat / DAY_MS) * DAY_MS - EAT_OFFSET_MS);
}

function eatMonthStart(year: number, monthIndex: number): Date {
  return new Date(Date.UTC(year, monthIndex, 1) - EAT_OFFSET_MS);
}

function parseDay(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const utc = new Date(Date.UTC(y, m - 1, d));
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== m - 1 || utc.getUTCDate() !== d) return null;
  return new Date(utc.getTime() - EAT_OFFSET_MS);
}

export function parseRevenuePreset(value: string | string[] | undefined): RevenuePreset {
  const raw = Array.isArray(value) ? value[0] : value;
  return REVENUE_PRESETS.some((p) => p.key === raw) ? (raw as RevenuePreset) : "last30";
}

export function resolveRevenueRange(
  preset: RevenuePreset,
  now: Date,
  custom: { from?: string; to?: string } = {}
): RevenueRange {
  const todayStart = startOfEatDay(now);
  const tomorrowStart = new Date(todayStart.getTime() + DAY_MS);
  const eatNow = new Date(now.getTime() + EAT_OFFSET_MS);
  const y = eatNow.getUTCFullYear();
  const m = eatNow.getUTCMonth();

  switch (preset) {
    case "today":
      return { preset, from: todayStart, to: tomorrowStart, label: "Today" };
    case "last7":
      return { preset, from: new Date(tomorrowStart.getTime() - 7 * DAY_MS), to: tomorrowStart, label: "Last 7 days" };
    case "last30":
      return { preset, from: new Date(tomorrowStart.getTime() - 30 * DAY_MS), to: tomorrowStart, label: "Last 30 days" };
    case "thisMonth":
      return { preset, from: eatMonthStart(y, m), to: eatMonthStart(y, m + 1), label: "This month" };
    case "previousMonth":
      return { preset, from: eatMonthStart(y, m - 1), to: eatMonthStart(y, m), label: "Previous month" };
    case "custom": {
      const from = parseDay(custom.from);
      const toDay = parseDay(custom.to);
      const fallback = resolveRevenueRange("last30", now);
      if (!from || !toDay) return { ...fallback, error: "Enter a valid start and end date (YYYY-MM-DD)." };
      const to = new Date(toDay.getTime() + DAY_MS); // end date is inclusive
      if (to <= from) return { ...fallback, error: "The end date must not be before the start date." };
      if ((to.getTime() - from.getTime()) / DAY_MS > MAX_CUSTOM_RANGE_DAYS) {
        return { ...fallback, error: `Custom ranges are limited to ${MAX_CUSTOM_RANGE_DAYS} days.` };
      }
      return { preset, from, to, label: `${custom.from} to ${custom.to}` };
    }
  }
}
