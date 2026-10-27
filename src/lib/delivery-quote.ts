/** Buyer-safe delivery projection shared between the API and browser. */
export type BuyerDeliveryQuote = {
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  county: string | null;
  subtotalCents: number;
  totalCents: number;
  estimateCents: number | null;
  feeCents: number;
  feeStatus: string;
  acceptedAt: string | null;
  quoteCents: number | null;
  quoteNote: string | null;
  quoteUpdatedAt: string | null;
  quoteVersion: number;
};
