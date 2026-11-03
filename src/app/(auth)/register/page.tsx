import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-card";
import { GoogleSignInButton } from "@/components/auth/google-signin-button";
import { AuthDivider } from "@/components/auth/auth-divider";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = {
  title: "Create your account",
  description: "Create a free MaliHub Kenya account to buy or sell.",
};

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ redirectTo?: string }> }) {
  const params = await searchParams;
  const redirectTo = params.redirectTo?.startsWith("/") && !params.redirectTo.startsWith("//") ? params.redirectTo : "/complete-profile";
  const loginHref = `/login?redirectTo=${encodeURIComponent(redirectTo)}`;
  return (
    <AuthCard
      title="Create your account"
      subtitle="Join thousands buying and selling across Kenya."
      footer={
        <>
          Already have an account?{" "}
          <Link href={loginHref} className="text-primary-400 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <Suspense fallback={null}>
        <GoogleSignInButton next={redirectTo} />
      </Suspense>
      <AuthDivider />
      <Suspense fallback={null}>
        <RegisterForm />
      </Suspense>
    </AuthCard>
  );
}
