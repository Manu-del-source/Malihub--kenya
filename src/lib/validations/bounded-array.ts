import { z } from "zod";

/**
 * Zod 3 validates every array element even after `.max()` fails. Reject an
 * oversized input before parsing its elements so one request cannot create an
 * unbounded number of validation issues (GHSA-mrhx-c7xc-m3w5).
 *
 * Non-arrays still reach the original schema, preserving its type errors and
 * normal validation behavior. This is not a substitute for HTTP body limits.
 */
export function boundedArray<T extends z.ZodTypeAny>(
  schema: T,
  max: number,
  message = `Array must contain at most ${max} element(s)`
) {
  return z
    .custom<z.input<T>>(
      (value) => !Array.isArray(value) || value.length <= max,
      { message, fatal: true }
    )
    .pipe(schema);
}
