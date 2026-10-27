import "server-only";

import { KENYA_COUNTIES } from "@/lib/constants";
import { isMoneyCents } from "@/lib/money";

export type DeliveryEstimate = {
  county: string;
  feeCents: number;
  currency: "KES";
  source: "COUNTY_RATE";
  basis: "PER_SELLER_ORDER";
  requiresConfirmation: true;
};

/**
 * Rates are explicit JSON keyed by canonical Kenya county, in KES minor units
 * (100 cents = KSh 1). Each seller dispatches a separate order and is charged
 * one rate. Missing/invalid configuration fails closed; distance pricing is
 * deliberately unsupported until a trusted routing provider is integrated.
 */
export function estimateCountyDelivery(countyInput: string): DeliveryEstimate {
  const county = KENYA_COUNTIES.find(
    (candidate) => candidate.toLowerCase() === countyInput.trim().toLowerCase()
  );
  if (!county) throw new Error("Select a valid Kenyan delivery county.");

  const raw = process.env.MALIHUB_DELIVERY_COUNTY_RATES_JSON;
  if (!raw?.trim()) throw new Error("Delivery pricing is not configured yet. Please contact support.");

  let rates: unknown;
  try {
    rates = JSON.parse(raw);
  } catch {
    throw new Error("Delivery pricing configuration is invalid. Please contact support.");
  }
  if (!rates || typeof rates !== "object" || Array.isArray(rates)) {
    throw new Error("Delivery pricing configuration is invalid. Please contact support.");
  }
  const entries = Object.entries(rates);
  if (entries.length === 0 || entries.some(([key, value]) =>
    !(KENYA_COUNTIES as readonly string[]).includes(key) || !isMoneyCents(value)
  )) {
    throw new Error("Delivery pricing configuration is invalid. Please contact support.");
  }
  const value = (rates as Record<string, unknown>)[county];
  if (!isMoneyCents(value)) {
    throw new Error("Delivery is not yet priced for this county. Please contact support.");
  }
  return { county, feeCents: value, currency: "KES", source: "COUNTY_RATE", basis: "PER_SELLER_ORDER", requiresConfirmation: true };
}
