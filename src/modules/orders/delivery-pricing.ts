import "server-only";

import { KENYA_COUNTIES } from "@/lib/constants";

export type DeliveryEstimate = {
  county: string;
  feeCents: number;
  source: "COUNTY_RATE";
  requiresConfirmation: boolean;
};

/**
 * County rates are configured by deployment operators as JSON:
 * MALIHUB_DELIVERY_COUNTY_RATES_JSON='{"Nairobi":25000,"Kiambu":35000}'
 * Values are in cents (100 cents = KSh 1). Missing county rates intentionally
 * fail closed: checkout must not silently quote free delivery.
 *
 * No distance-based fee is calculated until a trusted routing provider is
 * configured. Client-supplied distance is never accepted.
 */
export function estimateCountyDelivery(countyInput: string): DeliveryEstimate {
  const county = KENYA_COUNTIES.find(
    (candidate) => candidate.toLocaleLowerCase() === countyInput.trim().toLocaleLowerCase()
  );
  if (!county) throw new Error("Select a valid Kenyan delivery county.");

  const raw = process.env.MALIHUB_DELIVERY_COUNTY_RATES_JSON;
  if (!raw) throw new Error("Delivery pricing is not configured yet. Please contact support before placing this order.");

  let rates: unknown;
  try {
    rates = JSON.parse(raw);
  } catch {
    throw new Error("Delivery pricing configuration is invalid. Please contact support.");
  }
  if (!rates || typeof rates !== "object" || Array.isArray(rates)) {
    throw new Error("Delivery pricing configuration is invalid. Please contact support.");
  }

  const value = (rates as Record<string, unknown>)[county];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("Delivery is not yet priced for this county. Please contact support before placing this order.");
  }

  return { county, feeCents: value, source: "COUNTY_RATE", requiresConfirmation: true };
}
