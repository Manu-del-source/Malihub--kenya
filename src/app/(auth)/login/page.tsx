import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-card";
import { GoogleSignInButton } from "@/components/auth/google-signin-button";
import { AuthDivider } from "@/components/auth/auth-divider";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your MaliHub Kenya account.",
};

export default function LoginPage() {
  return (
    <AuthCard
      title="Welcome back"
      subtitle="Sign in to continue buying and selling on MaliHub."
      footer={
        <>
          Don&rsquo;t have an account?{" "}
          <Link href="/register" className="text-primary-400 hover:underline">
            Create one
          </Link>
        </>
      }
    >
      <GoogleSignInButton next="/dashboard/buyer" />
      <AuthDivider />
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AuthCard>
  );
}
