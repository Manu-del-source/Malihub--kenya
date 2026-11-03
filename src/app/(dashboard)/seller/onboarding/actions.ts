"use server";

import { logServerError } from "@/lib/safe-log";
import { revalidatePath } from "next/cache";
import { requireOnboardedActionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sellerApplicationSchema, type SellerApplicationInput } from "@/lib/validations/seller-onboarding";
import type { ApiResult } from "@/types";

function makeSlug(name: string, userId: string) {
  const base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return `${base || "seller"}-${userId.slice(0, 6).toLowerCase()}`;
}

/**
 * A seller application is attached to the authenticated MaliHub user.
 * Existing buyers receive a seller profile only after submitting valid
 * business details. The account role remains BUYER until admin verification.
 */
export async function submitSellerApplicationAction(
  input: SellerApplicationInput
): Promise<ApiResult<{ verificationStatus: "PENDING" }>> {
  const auth = await requireOnboardedActionUser();
  if (!auth.ok) return { success: false, error: auth.error };

  const parsed = sellerApplicationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Please check the application details.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    const data = parsed.data;
    await prisma.$transaction(async (tx) => {
      const currentUser = await tx.user.findUnique({
        where: { id: auth.user.id },
        select: { role: true, isActive: true, isBanned: true },
      });
      if (!currentUser || !currentUser.isActive || currentUser.isBanned) {
        throw new Error("This account cannot submit a seller application.");
      }
      if (currentUser.role === "ADMIN" || currentUser.role === "SUPER_ADMIN") {
        throw new Error("Administrator accounts cannot apply to become sellers.");
      }

      const existing = await tx.seller.findUnique({
        where: { userId: auth.user.id },
        select: { id: true, verificationStatus: true },
      });
      if (existing?.verificationStatus === "VERIFIED") {
        throw new Error("Your seller profile is already verified. Contact support if your business details need to change.");
      }

      const profileData = {
        businessName: data.businessName,
        slug: makeSlug(data.businessName, auth.user.id),
        description: data.description,
        county: data.county,
        subCounty: data.subCounty || null,
        kraPin: data.kraPin || null,
        verificationStatus: "PENDING" as const,
      };

      if (existing) {
        await tx.seller.update({ where: { id: existing.id }, data: profileData });
      } else {
        await tx.seller.create({
          data: {
            userId: auth.user.id,
            ...profileData,
          },
        });
      }
      // Deliberately do not change users.role here. Admin verification is the
      // only path that grants SELLER privileges and enables seller publishing.
    });

    revalidatePath("/seller/onboarding");
    revalidatePath("/seller");
    revalidatePath("/admin");
    revalidatePath("/admin/sellers");
    return { success: true, data: { verificationStatus: "PENDING" } };
  } catch (error) {
    logServerError("submitSellerApplicationAction failed", error);
    return {
      success: false,
      error: error instanceof Error && error.message !== "Internal Server Error"
        ? error.message
        : "We couldn't submit your application right now. Please try again.",
    };
  }
}
