"use server";

import { revalidatePath } from "next/cache";
import { requireOnboardedActionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sellerApplicationSchema, type SellerApplicationInput } from "@/lib/validations/seller-onboarding";
import type { ApiResult } from "@/types";

function makeSlug(name: string, sellerId: string) {
  const base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return `${base || "seller"}-${sellerId.slice(0, 6).toLowerCase()}`;
}

/**
 * A seller application is attached to the already-authenticated MaliHub user.
 * No user/seller id is accepted from the browser, and existing verified sellers
 * cannot accidentally revoke their approval by resubmitting this form.
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
    const seller = await prisma.seller.findUnique({
      where: { userId: auth.user.id },
      select: { id: true, verificationStatus: true },
    });

    if (!seller) {
      return {
        success: false,
        error: "Start your seller profile from Account before submitting an application.",
      };
    }

    if (seller.verificationStatus === "VERIFIED") {
      return {
        success: false,
        error: "Your seller profile is already verified. Contact support if your business details need to change.",
      };
    }

    const data = parsed.data;
    await prisma.seller.update({
      where: { id: seller.id },
      data: {
        businessName: data.businessName,
        slug: makeSlug(data.businessName, seller.id),
        description: data.description,
        county: data.county,
        subCounty: data.subCounty || null,
        kraPin: data.kraPin || null,
        verificationStatus: "PENDING",
      },
    });

    revalidatePath("/seller/onboarding");
    revalidatePath("/seller");
    revalidatePath("/admin");
    revalidatePath("/admin/sellers");
    return { success: true, data: { verificationStatus: "PENDING" } };
  } catch (error) {
    console.error("submitSellerApplicationAction failed", error);
    return {
      success: false,
      error: "We couldn't submit your application right now. Please try again.",
    };
  }
}
