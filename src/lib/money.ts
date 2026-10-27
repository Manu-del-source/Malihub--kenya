/** PostgreSQL/Prisma Int columns and Paystack amounts use KES minor units. */
export const MAX_MONEY_CENTS = 2_147_483_647;

export function isMoneyCents(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_MONEY_CENTS;
}

/** Returns null rather than allowing overflow or an invalid value into an Int column. */
export function addMoneyCents(...values: number[]): number | null {
  let total = 0;
  for (const value of values) {
    if (!isMoneyCents(value)) return null;
    total += value;
    if (!isMoneyCents(total)) return null;
  }
  return total;
}
