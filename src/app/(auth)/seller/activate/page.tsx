import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-card";
import { SellerInvitationActivationForm } from "@/components/auth/seller-invitation-activation-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Activate seller account",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function SellerActivationPage() {
  return (
    <AuthCard
      title="Set up your seller account"
      subtitle="Choose a password for your MaliHub seller account. You must verify your email before signing in."
    >
      <SellerInvitationActivationForm />
    </AuthCard>
  );
}
