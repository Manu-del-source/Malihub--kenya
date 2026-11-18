/**
 * Pure pricing rules shared by listing validation, product display, cart and
 * checkout. Prices are integer cents; the product's priceCents is the
 * single-unit/base price and a tier applies at and above minQuantity.
 */
export type ProductPriceTierInput = {
  minQuantity: number;
  unitPriceCents: number;
};

export const MAX_PRODUCT_PRICE_TIERS = 8;

export function validateProductPriceTiers(
  basePriceCents: number,
  tiers: ProductPriceTierInput[]
): ProductPriceTierInput[] {
  if (!Number.isSafeInteger(basePriceCents) || basePriceCents < 100) {
    throw new Error("The base price must be at least KSh 1.");
  }
  if (tiers.length > MAX_PRODUCT_PRICE_TIERS) {
    throw new Error(`Add no more than ${MAX_PRODUCT_PRICE_TIERS} quantity price tiers.`);
  }

  const sorted = [...tiers].sort((a, b) => a.minQuantity - b.minQuantity);
  let previousQuantity = 1;
  let previousPrice = basePriceCents;

  for (const tier of sorted) {
    if (!Number.isSafeInteger(tier.minQuantity) || tier.minQuantity < 2) {
      throw new Error("A quantity price tier must start at 2 units or more.");
    }
    if (tier.minQuantity <= previousQuantity) {
      throw new Error("Each quantity price tier must have a different minimum quantity.");
    }
    if (!Number.isSafeInteger(tier.unitPriceCents) || tier.unitPriceCents < 100) {
      throw new Error("Tier prices must be at least KSh 1.");
    }
    if (tier.unitPriceCents >= previousPrice) {
      throw new Error("Each higher-quantity tier must be cheaper than the previous price.");
    }
    previousQuantity = tier.minQuantity;
    previousPrice = tier.unitPriceCents;
  }

  return sorted;
}

export function getUnitPriceCents(
  basePriceCents: number,
  tiers: ProductPriceTierInput[],
  quantity: number
): number {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new Error("Quantity must be a positive whole number.");
  }
  let unitPrice = basePriceCents;
  for (const tier of tiers) {
    if (tier.minQuantity > quantity) break;
    unitPrice = tier.unitPriceCents;
  }
  return unitPrice;
}
