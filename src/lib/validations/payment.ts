import { z } from "zod";

/**
 * Validation for the payment collection API surface.
 *
 * What this boundary accepts is deliberately small: an order id, and
 * (optionally) the phone number to prompt. Amount, provider channel, callback
 * URL and buyer identity are NEVER request fields — they are derived
 * server-side from the order row, the environment and the session
 * respectively. A request body cannot steer money.
 */

/**
 * Kenyan phone numbers in any of the common local formats — the same rule the
 * account/profile schema enforces (`src/lib/validations/auth.ts`), kept
 * byte-identical so a number accepted at onboarding is accepted at checkout.
 * Normalization to MSISDN happens through `toKenyanMsisdn` at the point of
 * use, never here.
 */
export const kenyanPhoneRegex = /^(?:\+?254|0)(7|1)\d{8}$/;

export const initiateStkSchema = z.object({
  orderId: z.string().uuid("A valid order id is required."),
  /**
   * Optional override for the phone to prompt. When omitted, the buyer's
   * account phone (validated at onboarding) is used. Either way the value is
   * validated against the same rule and normalized server-side before it
   * reaches PayHero.
   */
  phoneNumber: z
    .string()
    .trim()
    .regex(kenyanPhoneRegex, "Enter a valid Kenyan phone number, e.g. 0712345678")
    .optional(),
});

export type InitiateStkInput = z.infer<typeof initiateStkSchema>;
