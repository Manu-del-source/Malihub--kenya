import Link from "next/link";
import type { Metadata } from "next";
import { MailCheck } from "lucide-react";
import { AuthCard } from "@/components/auth/auth-card";
import { ResendVerificationButton } from "@/components/auth/resend-verification-button";

export const metadata: Metadata = {
  title: "Verify your email",
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

  return (
    <AuthCard
      title="Check your inbox"
      subtitle={
        email
          ? `We sent a verification link to ${email}.`
          : "We sent a verification link to your email address."
      }
      footer={
        <>
          Wrong email?{" "}
          <Link href="/register" className="text-primary-400 hover:underline">
            Start over
          </Link>
        </>
      }
    >
      <div className="flex flex-col items-center gap-4 py-2">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-cyan/15 text-cyan">
          <MailCheck className="h-6 w-6" aria-hidden />
        </div>
        <p className="text-center text-sm text-muted-foreground">
          Click the link in the email to verify your account, then you&rsquo;ll be taken
          straight to setting up your profile.
        </p>
        {email && <ResendVerificationButton email={email} />}
      </div>
    </AuthCard>
  );
}
