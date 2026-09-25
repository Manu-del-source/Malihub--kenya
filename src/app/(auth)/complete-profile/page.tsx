import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-card";
import { CompleteProfileForm } from "@/components/auth/complete-profile-form";
import { getAuthContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Rendered per request — never prerendered: this route reads the session.
 *
 * Required because reading a Neon Auth session does not necessarily touch a
 * cookie (an unconfigured environment short-circuits first), so Next.js would
 * otherwise prerender this page as a static redirect to /login. The full
 * reasoning is in the layout banners and docs/auth/ARCHITECTURE.md §6.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Complete your profile",
};

export default async function CompleteProfilePage() {
  // Identity, not a mapped application user. A brand-new account can reach this
  // page before its `users`/`profiles` rows exist — sign-up provisioning is
  // best-effort, and `completeProfileAction` provisions authoritatively inside
  // its own transaction. Requiring a mapped user here would make first-time
  // onboarding impossible.
  const { identity, user } = await getAuthContext();

  if (!identity) {
    redirect("/login?redirectTo=/complete-profile");
  }

  const profile = user
    ? await prisma.profile.findUnique({
        where: { userId: user.id },
        select: { onboarded: true, fullName: true, avatarUrl: true },
      })
    : null;

  if (profile?.onboarded) {
    // A profile row only exists for a mapped application user, but TypeScript
    // cannot infer that from `profile` alone.
    redirect(user?.hasSellerProfile ? "/dashboard/seller" : "/dashboard/buyer");
  }

  return (
    <AuthCard
      title="Complete your profile"
      subtitle="A few quick details so buyers and sellers know who they're dealing with."
    >
      <CompleteProfileForm
        // Used only as the Supabase Storage folder for the avatar upload. The
        // application id is preferred, but an account whose rows have not been
        // provisioned yet still needs a stable per-person prefix — the auth
        // identity provides one. It is never used for authorization.
        userId={user?.id ?? identity.authUserId}
        // Display name and photo now come from the auth identity (`user.name` /
        // `user.image`) rather than the previous provider's `user_metadata`,
        // which Managed Better Auth does not have.
        defaultFullName={profile?.fullName || identity.name || ""}
        defaultAvatarUrl={profile?.avatarUrl ?? identity.image ?? ""}
      />
    </AuthCard>
  );
}
