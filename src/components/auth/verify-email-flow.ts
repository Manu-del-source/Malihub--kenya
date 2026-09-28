import type { ApiResult } from "@/types";

/**
 * The two "send me something" paths of the verify-email panel, as pure
 * functions of the Server Actions they call.
 *
 * They live outside the component so the regression this file exists for can be
 * tested without a DOM: "Enter a code instead" must request a CODE (and never a
 * link), and the screen may switch to code mode only after that request
 * succeeded.
 *
 *   resend link  → resendVerificationAction   (link first; code only if the
 *                                              branch has links disabled)
 *   enter a code → sendVerificationCodeAction (code, always)
 */

export const COOLDOWN_SECONDS = 45;

export type VerificationMode = "link" | "code";

export type SendOutcome =
  | { ok: false; error: string }
  | { ok: true; mode: VerificationMode; cooldown: number; message: string };

/** "Resend verification email" — stays a link operation. */
export async function runResendLink(
  resend: (email: string) => Promise<ApiResult<{ method: VerificationMode }>>,
  email: string
): Promise<SendOutcome> {
  const result = await resend(email);
  if (!result.success) return { ok: false, error: result.error };

  if (result.data.method === "code") {
    // Links are not enabled on this branch, so "click the link in your email"
    // would leave the person waiting for something that was never sent.
    return {
      ok: true,
      mode: "code",
      cooldown: COOLDOWN_SECONDS,
      message: "We sent a 6-digit code to your email.",
    };
  }

  return {
    ok: true,
    mode: "link",
    cooldown: COOLDOWN_SECONDS,
    message: "Verification email resent.",
  };
}

/**
 * "Didn't get a link? Enter a code instead" and "Resend code".
 * Switches to code mode only on success; on failure the caller stays where it is.
 */
export async function runSendCode(
  sendCode: (email: string) => Promise<ApiResult<true>>,
  email: string
): Promise<SendOutcome> {
  const result = await sendCode(email);
  if (!result.success) return { ok: false, error: result.error };

  return {
    ok: true,
    mode: "code",
    cooldown: COOLDOWN_SECONDS,
    message: "We sent a 6-digit code to your email.",
  };
}
