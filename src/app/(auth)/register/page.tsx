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

export default function RegisterPage() {
  return (
    <AuthCard
      title="Create your account"
      subtitle="Join thousands buying and selling across Kenya."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="text-primary-400 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <GoogleSignInButton next="/complete-profile" />
      <AuthDivider />
      <RegisterForm />
    </AuthCard>
  );
}
