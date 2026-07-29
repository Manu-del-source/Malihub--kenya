import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-card";
import { CompleteProfileForm } from "@/components/auth/complete-profile-form";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  title: "Complete your profile",
};

export default async function CompleteProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?redirectTo=/complete-profile");
  }

  const profile = await prisma.profile.findUnique({
    where: { userId: user.id },
    select: { onboarded: true, fullName: true, avatarUrl: true },
  });

  if (profile?.onboarded) {
    redirect("/dashboard/buyer");
  }

  return (
    <AuthCard
      title="Complete your profile"
      subtitle="A few quick details so buyers and sellers know who they're dealing with."
    >
      <CompleteProfileForm
        userId={user.id}
        defaultFullName={
          profile?.fullName || user.user_metadata?.full_name || user.user_metadata?.name || ""
        }
        defaultAvatarUrl={profile?.avatarUrl ?? user.user_metadata?.avatar_url ?? ""}
      />
    </AuthCard>
  );
}
