/** The size system is optional, including for older products. */
export const SIZE_SYSTEMS = ["UK", "US", "EU", "CLOTHING", "OTHER"] as const;
export type SizeSystem = (typeof SIZE_SYSTEMS)[number];

export function isSizeSystem(value: unknown): value is SizeSystem {
  return typeof value === "string" && (SIZE_SYSTEMS as readonly string[]).includes(value);
}

/** Normalize a seller-entered comma-separated list without inventing sizes. */
export function normalizeAvailableSizes(value: string): string {
  const seen = new Set<string>();
  return value.split(",").map((part) => part.trim()).filter((part) => {
    const key = part.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(", ");
}

/** Tolerant projection for historical/malformed records; never renders an object. */
export function productSizeLabels(product: {
  size?: unknown;
  sizeSystem?: unknown;
  availableSizes?: unknown;
}): string[] {
  const size = typeof product.size === "string" ? product.size.trim() : "";
  const available = typeof product.availableSizes === "string" ? product.availableSizes.trim() : "";
  const system = isSizeSystem(product.sizeSystem)
    ? product.sizeSystem === "CLOTHING" ? "Clothing" : product.sizeSystem
    : "";
  const suffix = system ? ` (${system})` : "";
  return [size ? `Size: ${size}${suffix}` : "", available ? `Available sizes: ${available}${suffix}` : ""].filter(Boolean);
}
