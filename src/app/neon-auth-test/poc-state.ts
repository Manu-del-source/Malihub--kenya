/**
 * Form state for the Neon Auth POC's `useActionState` forms.
 *
 * Kept out of `actions.ts` on purpose: a `"use server"` module may only export
 * async functions, so the idle-state constant (and its type) live here. The
 * Next.js build rejects the alternative with
 * `A "use server" file can only export async functions, found object.`
 */
export type NeonPocFormState = {
  status: "idle" | "error" | "success";
  message?: string;
};

export const NEON_POC_IDLE_STATE: NeonPocFormState = { status: "idle" };
