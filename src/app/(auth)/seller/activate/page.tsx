import Link from "next/link";
import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-card";
import { SellerInvitationActivationForm } from "@/components/auth/seller-invitation-activation-form";
import { getSellerInvitationDetails } from "@/services/admin-seller-onboarding-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Activate seller account",
  referrer: "no-referrer",
};

export default async function SellerActivationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const invitationToken = typeof token === "string" ? token : "";
  const invitation = invitationToken
    ? await getSellerInvitationDetails(invitationToken)
    : null;

  if (!invitation) {
    return (
      <AuthCard title="Invitation unavailable" subtitle="This seller invitation is invalid, expired, or has already been used.">
        <p className="text-center text-sm text-muted-foreground">
          Contact the MaliHub administrator and ask them to generate a new invitation.
        </p>
        <Link href="/login" className="text-center text-sm text-primary-400 hover:underline">
          Return to sign in
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Set up your seller account"
      subtitle={`Create a password for ${invitation.businessName}. Email verification will be required before you can sign in.`}
    >
      <p className="text-center text-sm text-muted-foreground">
        Account email: <span className="font-medium text-foreground">{invitation.email}</span>
      </p>
      <SellerInvitationActivationForm token={invitationToken} />
    </AuthCard>
  );
}
