/**
 * Dispatch service level used by admin monitoring ONLY (a filter and a badge).
 * It never changes an order, a payment or a payout.
 *
 * ASSUMPTION: the platform has no recorded dispatch SLA, so the default below
 * is a monitoring placeholder. Set ORDER_DISPATCH_SLA_HOURS to the approved
 * business rule. Clock starts at the successful payment time.
 */
export const DEFAULT_DISPATCH_SLA_HOURS = 48;

export function dispatchSlaHours(raw: string | undefined = process.env.ORDER_DISPATCH_SLA_HOURS): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n <= 24 * 30 ? n : DEFAULT_DISPATCH_SLA_HOURS;
}

export function dispatchOverdueCutoff(now: Date, hours: number = dispatchSlaHours()): Date {
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}

/** PAID (confirmed, not yet shipped) and paid longer ago than the SLA. */
export function isDispatchOverdue(
  status: string,
  paidAt: Date | null | undefined,
  now: Date,
  hours: number = dispatchSlaHours()
): boolean {
  return status === "PAID" && !!paidAt && paidAt < dispatchOverdueCutoff(now, hours);
}
