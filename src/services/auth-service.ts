import "server-only";
import { prisma } from "@/lib/prisma";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { slugify } from "@/utils";
import type { CompleteProfileInput } from "@/lib/validations/auth";
import type { Prisma } from "@prisma/client";

export class AuthServiceError extends Error {}

/**
 * Runs everything that needs to happen once a user submits /complete-profile:
 *  1. Claim their phone number + finish their Profile row (onboarded = true).
 *  2. If they opted into selling, create a starter Seller row.
 *  3. Mirror the resulting role into the Supabase JWT's app_metadata, so
 *     middleware can read it at the edge without a DB round trip on every
 *     request (see ARCHITECTURE.md §5).
 *
 * Wrapped in a Prisma transaction for the User/Profile/Seller writes; the
 * JWT sync happens after commit since it's a separate system (Supabase
 * Auth) that can't participate in the Postgres transaction.
 */
export async function completeUserProfile(userId: string, input: CompleteProfileInput) {
  const wantsToSell = input.accountIntent === "SELLER" || input.accountIntent === "BOTH";
  const role = wantsToSell ? "SELLER" : "BUYER";

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // Phone numbers are unique — surface a friendly conflict instead of a
    // raw Postgres constraint error if someone else already claimed it.
    const existingPhone = await tx.user.findFirst({
      where: { phone: input.phone, NOT: { id: userId } },
      select: { id: true },
    });
    if (existingPhone) {
      throw new AuthServiceError(
        "That phone number is already linked to another MaliHub account."
      );
    }

    await tx.user.update({
      where: { id: userId },
      data: { phone: input.phone, role },
    });

    await tx.profile.update({
      where: { userId },
      data: {
        fullName: input.fullName,
        county: input.county,
        avatarUrl: input.avatarUrl || null,
        onboarded: true,
      },
    });

    if (wantsToSell) {
      const existingSeller = await tx.seller.findUnique({ where: { userId } });
      if (!existingSeller) {
        await tx.seller.create({
          data: {
            userId,
            businessName: input.fullName,
            slug: slugify(input.fullName),
            county: input.county,
          },
        });
      }
    }
  });

  // Best-effort: if this fails, middleware's fallback DB check (see
  // src/middleware.ts) still catches it on the next request — the JWT
  // claim is a fast path, not the source of truth.
  try {
    const supabase = createServiceRoleClient();
    await supabase.auth.admin.updateUserById(userId, {
      app_metadata: { role, has_seller_profile: wantsToSell, onboarded: true },
    });
  } catch (error) {
    console.error("Failed to sync role into Supabase app_metadata", error);
  }

  return { role, wantsToSell };
}
