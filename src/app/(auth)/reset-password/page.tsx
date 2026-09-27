import Link from "next/link";
import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-card";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = {
  title: "Set a new password",
};

/**
 * Landing page for the emailed password-reset link.
 *
 * The auth service appends `?token=…` to the `redirectTo` it was given, or
 * `?error=INVALID_TOKEN` when the link has already expired (reset links live for
 * 15 minutes). This page reads that query string and hands the token to the
 * form.
 *
 * BEHAVIOUR CHANGE from the Supabase version, and a deliberate one: this page no
 * longer requires a signed-in session. The previous provider exchanged the
 * emailed link for a logged-in "recovery" session at `/api/auth/callback`, so
 * the page could infer validity from `getUser()`. The new provider issues a
 * one-time token that `resetPasswordAction` consumes directly, which means this
 * page is reached while signed OUT — requiring a session here would have made
 * password reset impossible. Validity is decided by the token, not by a cookie.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  const validToken = typeof token === "string" && token.trim() ? token.trim() : null;

  if (!validToken || error) {
    return (
      <AuthCard title="Link expired" subtitle="This password reset link is no longer valid.">
        <Link
          href="/forgot-password"
          className="text-center text-sm text-primary-400 hover:underline"
        >
          Request a new reset link
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Set a new password" subtitle="Choose a strong password you haven't used before.">
      <ResetPasswordForm token={validToken} />
    </AuthCard>
  );
}
