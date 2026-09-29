"use server";

import { revalidatePath } from "next/cache";
import { requireOnboardedActionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enableSelling, AuthServiceError } from "@/services/account-provisioning";
import type { ApiResult } from "@/types";

/**
 * Lets an onboarded BUYER start selling — the post-onboarding equivalent of
 * `/complete-profile`'s `accountIntent`.
 *
 * Authorization: the account is resolved from the server session
 * (`requireOnboardedActionUser`); the service then re-reads MaliHub's own rows
 * inside a transaction. Nothing about identity, role or ownership comes from
 * the request. The write only ever ADDS seller access to the caller — it can
 * never attach someone else's account or downgrade a role.
 */
export async function startSellingAction(): Promise<
  ApiResult<{ sellerId: string; alreadyEnabled: boolean }>
> {
  const auth = await requireOnboardedActionUser();
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  try {
    const result = await enableSelling(prisma, auth.user.id);
    revalidatePath("/account");
    revalidatePath("/seller");
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return { success: false, error: error.message };
    }
    console.error("startSellingAction failed", error);
    return { success: false, error: "Something went wrong. Please try again." };
  }
}
