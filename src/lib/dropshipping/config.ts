/**
 * Server-side, non-secret configuration for dropshipping estimates.
 *
 * Nothing here invents a commercial rule. Fee/tax rates are ZERO until an
 * operator explicitly configures them, and the result is flagged as an
 * estimate until `DROPSHIPPING_FEE_CONFIG_VERIFIED=true` says the business has
 * approved those exact values. The frontend never reads these variables
 * directly: every calculation happens on the server.
 */

export type DropshippingConfig = {
  /** Basis points of the retail price charged by the payment processor. */
  paymentFeeBps: number;
  /** Basis points of the retail price reserved for applicable tax. */
  taxBps: number;
  /** Operational freshness threshold; never a supplier availability guarantee. */
  stockMaxAgeHours: number;
  /** True only when the operator has confirmed the configured rates. */
  feeConfigVerified: boolean;
  /** Stable fingerprint stored with a cost snapshot so stale math is visible. */
  configVersion: string;
  warnings: string[];
};

const MAX_BPS = 10_000;

function readIntegerBps(value: string | undefined, name: string, warnings: string[]): number {
  if (value === undefined || value.trim() === "") {
    warnings.push(`${name}_unconfigured`);
    return 0;
  }
  if (!/^\d+$/.test(value.trim())) {
    warnings.push(`${name}_invalid`);
    return 0;
  }
  const parsed = Number(value.trim());
  if (!Number.isSafeInteger(parsed) || parsed > MAX_BPS) {
    warnings.push(`${name}_invalid`);
    return 0;
  }
  return parsed;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || !/^\d+$/.test(value.trim())) return fallback;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 24 * 30 ? parsed : fallback;
}

/** Reads a strict config. Unknown/invalid values fail safe to zero + warning. */
export function readDropshippingConfig(
  env: NodeJS.ProcessEnv = process.env,
): DropshippingConfig {
  const warnings: string[] = [];
  const paymentFeeBps = readIntegerBps(env.DROPSHIPPING_PAYMENT_FEE_BPS, "payment_fee", warnings);
  const taxBps = readIntegerBps(env.DROPSHIPPING_TAX_BPS, "tax", warnings);
  const stockMaxAgeHours = readPositiveInteger(env.DROPSHIPPING_STOCK_MAX_AGE_HOURS, 48);
  const feeConfigVerified = env.DROPSHIPPING_FEE_CONFIG_VERIFIED === "true";
  if (!feeConfigVerified) warnings.push("fee_config_unverified");

  return {
    paymentFeeBps,
    taxBps,
    stockMaxAgeHours,
    feeConfigVerified,
    configVersion: `v1:${paymentFeeBps}:${taxBps}:${feeConfigVerified ? "verified" : "unverified"}`,
    warnings,
  };
}
