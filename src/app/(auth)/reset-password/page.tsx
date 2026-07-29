import Link from "next/link";
import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-card";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Set a new password",
};

export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
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
      <ResetPasswordForm />
    </AuthCard>
  );
}
