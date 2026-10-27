import { z } from "zod";

/**
 * Validation for the payment collection API surface.
 *
 * What this boundary accepts is deliberately small: an order id and an
 * optimistic quote-version precondition. Amount,
 * provider settings, callback URL and buyer identity are NEVER request
 * fields — they are derived server-side from the order row, the environment
 * and the session respectively. A request body cannot steer money.
 */

/**
 * `POST /api/payments/paystack/initialize` — the order id and quote version
 * of a PENDING order the caller owns. Everything else (amount, email, currency,
 * provider settings) is read from the order row, the session and server
 * configuration inside the route.
 */
export const initiatePaystackSchema = z.object({
  orderId: z.string().uuid("A valid order id is required."),
  // Optimistic precondition only: the server still derives all amounts.
  quoteVersion: z.number().int().min(0).max(2_147_483_647),
}).strict();

export type InitiatePaystackInput = z.infer<typeof initiatePaystackSchema>;

/**
 * The buyer's own payment-status lookup / verification request.
 *
 * One field, because ownership and monetary facts come from the session and
 * the order row: there is no payment id, buyer id, amount or status for a
 * request to steer. (`not_found` is answered for another buyer's order id —
 * the same no-oracle rule the initiation route and the order screens use.)
 */
export const paymentStatusRequestSchema = z.object({
  orderId: z.string().uuid("A valid order id is required."),
});

export type PaymentStatusRequestInput = z.infer<typeof paymentStatusRequestSchema>;
