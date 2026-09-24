"use server";

import { redirect } from "next/navigation";
import { getNeonAuth } from "@/lib/neon-auth/server";
import { isNeonAuthPocEnabled, NEON_AUTH_POC_BASE_PATH } from "@/lib/neon-auth/config";
import type { NeonPocFormState } from "./poc-state";

/**
 * Server Actions for the Neon Auth POC.
 *
 * Deliberately separate from `src/app/(auth)/actions.ts`:
 *  - no Supabase call of any kind (`signInWithPassword`, `getUser`, admin
 *    `updateUserById`, `refreshSession`, `app_metadata` are never touched),
 *  - no MaliHub provisioning (`ensureUserProvisioned`, `saveCompletedProfile`,
 *    `completeUserProfile` are never called),
 *  - no Prisma writes — the Neon Auth user stays disconnected from the
 *    `users`/`profiles` tables for this evaluation.
 *
 * @see https://neon.com/docs/auth/reference/nextjs-server
 */

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** Creates a Managed Better Auth email/password account (Better Auth `signUp.email`). */
export async function neonSignUpAction(
  _previous: NeonPocFormState,
  formData: FormData
): Promise<NeonPocFormState> {
  if (!isNeonAuthPocEnabled()) {
    return { status: "error", message: "The Neon Auth POC is not enabled in this environment." };
  }

  const email = text(formData, "email");
  const password = String(formData.get("password") ?? "");
  const name = text(formData, "name") || email.split("@")[0] || "POC User";

  if (!email || !password) {
    return { status: "error", message: "Email and password are required." };
  }

  const { error } = await getNeonAuth().signUp.email({ email, password, name });
  if (error) {
    return { status: "error", message: error.message || "Sign-up failed." };
  }

  return { status: "success", message: `Account created for ${email}. Session cookie issued.` };
}

/** Signs in with email/password (Better Auth `signIn.email`). */
export async function neonSignInAction(
  _previous: NeonPocFormState,
  formData: FormData
): Promise<NeonPocFormState> {
  if (!isNeonAuthPocEnabled()) {
    return { status: "error", message: "The Neon Auth POC is not enabled in this environment." };
  }

  const email = text(formData, "email");
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    return { status: "error", message: "Email and password are required." };
  }

  const { error } = await getNeonAuth().signIn.email({ email, password });
  if (error) {
    return { status: "error", message: error.message || "Sign-in failed." };
  }

  return { status: "success", message: `Signed in as ${email}.` };
}

/**
 * Signs out and returns to the POC landing page.
 *
 * `redirect()` throws by design, so this action intentionally has no trailing
 * return: the cookies cleared by the SDK are written by the time it resolves.
 */
export async function neonSignOutAction(): Promise<void> {
  if (!isNeonAuthPocEnabled()) {
    redirect(NEON_AUTH_POC_BASE_PATH);
  }

  await getNeonAuth().signOut();
  redirect(NEON_AUTH_POC_BASE_PATH);
}
