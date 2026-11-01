"use server";

import { logServerError } from "@/lib/safe-log";
import { resetPasswordSchema, type ResetPasswordInput } from "@/lib/validations/auth";
import { activateSellerInvitation, SellerOnboardingError } from "@/services/admin-seller-onboarding-service";
import type { ApiResult } from "@/types";

/**
 * Redeems an admin-issued bearer invitation. The token is validated and
 * consumed server-side; only the seller-chosen password is passed to Neon Auth.
 */
export async function activateSellerInvitationAction(
  input: ResetPasswordInput,
  token: string
): Promise<ApiResult<{ redirectTo: string }>> {
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Check the password requirements and try again.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    const result = await activateSellerInvitation({
      token,
      password: parsed.data.password,
    });
    return {
      success: true,
      data: { redirectTo: `/verify-email?email=${encodeURIComponent(result.email)}` },
    };
  } catch (error) {
    if (error instanceof SellerOnboardingError) {
      return { success: false, error: error.message };
    }
    logServerError("[seller-invitation] Activation failed", error);
    return {
      success: false,
      error: "We couldn't activate this invitation. Please try again or request a new link.",
    };
  }
}
