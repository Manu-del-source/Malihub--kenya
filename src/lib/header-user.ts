import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { HeaderUser } from "@/components/landing/account-menu";

/**
 * The signed-in visitor as the public site header needs them, or null when
 * signed out. A lookup, not a guard: public pages stay public.
 */
export async function getHeaderUser(): Promise<HeaderUser | null> {
  const current = await getCurrentUser();
  const user = current?.user;
  if (!user) return null;

  const profile = await prisma.profile.findUnique({
    where: { userId: user.id },
    select: { fullName: true, avatarUrl: true },
  });

  return {
    email: user.email,
    fullName: profile?.fullName || null,
    avatarUrl: profile?.avatarUrl || current?.identity.image || null,
    hasSellerProfile: user.hasSellerProfile,
  };
}
