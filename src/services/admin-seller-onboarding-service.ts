import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { providerSendVerificationCode } from "@/lib/auth/neon";
import { resolveNeonAuthBaseUrl } from "@/lib/auth/config";
import { logAuditEvent } from "@/services/audit-service";
import { logServerError } from "@/lib/safe-log";
import { slugify } from "@/utils";

export type CreateAdminSellerInput = {
  email: string;
  fullName: string;
  businessName: string;
  county: string;
  subCounty?: string;
};

export class SellerOnboardingError extends Error {}

function neonManagementConfig() {
  const apiKey = process.env.NEON_API_KEY?.trim();
  const projectId = process.env.NEON_PROJECT_ID?.trim();
  const branchId = process.env.NEON_AUTH_BRANCH_ID?.trim();

  if (!apiKey || !projectId || !branchId) return null;
  return { apiKey, projectId, branchId };
}

async function createNeonIdentity(input: {
  email: string;
  name: string;
}): Promise<string> {
  const baseUrl = resolveNeonAuthBaseUrl();
  if (!baseUrl) {
    throw new SellerOnboardingError("Neon Auth is not configured for this deployment.");
  }

  // A one-time random credential lets Better Auth create the credential
  // account. It is never returned, logged or stored by MaliHub. The seller
  // verifies their email, then uses Forgot password to choose a known password.
  const temporaryPassword = randomBytes(32).toString("base64url");
  const appOrigin = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "").origin;
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/sign-up/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: appOrigin,
    },
    body: JSON.stringify({
      email: input.email,
      password: temporaryPassword,
      name: input.name,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    if (response.status === 409 || response.status === 422) {
      throw new SellerOnboardingError(
        "An authentication account with this email already exists. Ask the seller to sign in or use Forgot password."
      );
    }
    throw new SellerOnboardingError(
      response.status >= 500
        ? "Neon Auth is temporarily unavailable. No seller account was created."
        : "Neon Auth could not create this account. Check the email and try again."
    );
  }

  const payload = (await response.json()) as {
    id?: unknown;
    user?: { id?: unknown };
    data?: { user?: { id?: unknown } };
  };
  const authUserId =
    typeof payload.user?.id === "string"
      ? payload.user.id
      : typeof payload.data?.user?.id === "string"
        ? payload.data.user.id
        : typeof payload.id === "string"
          ? payload.id
          : null;

  if (!authUserId) {
    throw new SellerOnboardingError(
      "Neon Auth did not return the new account ID. Contact support before retrying."
    );
  }

  return authUserId;
}

async function deleteNeonIdentity(authUserId: string): Promise<boolean> {
  const config = neonManagementConfig();
  if (!config) return false;
  const { apiKey, projectId, branchId } = config;
  const response = await fetch(
    `https://console.neon.tech/api/v2/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/auth/users/${encodeURIComponent(authUserId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      cache: "no-store",
    }
  );
  return response.ok;
}


/**
 * Creates a real Neon Auth identity, maps it to MaliHub's own user UUID, and
 * creates the profile + unverified seller record in one Prisma transaction.
 * The one-time temporary password is used only for Neon Auth provisioning; MaliHub never stores or returns it.
 */
export async function createAdminSellerAccount(input: CreateAdminSellerInput, actor: {
  id: string;
  email: string;
}): Promise<{
  userId: string;
  sellerId: string;
  businessName: string;
  email: string;
  verificationCodeSent: boolean;
}> {
  if (!process.env.NEXT_PUBLIC_APP_URL?.trim()) {
    throw new SellerOnboardingError("NEXT_PUBLIC_APP_URL must be configured before seller onboarding.");
  }
  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim();
  const businessName = input.businessName.trim();
  const county = input.county.trim();

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    throw new SellerOnboardingError(
      "A MaliHub account already uses this email. Use the existing account instead of creating a duplicate."
    );
  }

  const authUserId = await createNeonIdentity({ email, name: fullName });
  const userId = randomUUID();
  const baseSlug = slugify(businessName) || "seller";
  const existingSlug = await prisma.seller.findUnique({
    where: { slug: baseSlug },
    select: { id: true },
  });
  const sellerSlug = existingSlug ? `${baseSlug}-${userId.slice(0, 6)}` : baseSlug;

  let created: { id: string; seller: { id: string } | null };
  try {
    created = await prisma.user.create({
      data: {
        id: userId,
        authUserId,
        email,
        role: "BUYER",
        emailVerified: false,
        profile: {
          create: {
            fullName,
            county,
            subCounty: input.subCounty?.trim() || null,
            onboarded: true,
          },
        },
        seller: {
          create: {
            businessName,
            slug: sellerSlug,
            county,
            subCounty: input.subCounty?.trim() || null,
            verificationStatus: "UNVERIFIED",
          },
        },
      },
      select: { id: true, seller: { select: { id: true } } },
    });
  } catch (error) {
    // The Neon identity is created first because its id is the mapping key.
    // Roll it back if the application transaction fails, avoiding an orphan.
    try {
      const removed = await deleteNeonIdentity(authUserId);
      if (!removed) {
        logServerError(
          "Admin seller onboarding could not clean up the Neon identity after a database failure",
          new Error("Optional Neon Management API cleanup is unavailable or was rejected.")
        );
      }
    } catch {
      // The original database error is the useful failure; cleanup is best effort.
    }
    const code = (error as { code?: string })?.code;
    if (code === "P2002") {
      throw new SellerOnboardingError(
        "That seller email or shop URL is already in use. Check the details and try again."
      );
    }
    throw error;
  }

  if (!created.seller) {
    throw new SellerOnboardingError("The seller profile could not be linked to the new account.");
  }

  const verification = await providerSendVerificationCode({ email });
  const verificationCodeSent = verification.failure === null && verification.data === true;

  await logAuditEvent({
    action: "admin.seller_created",
    actorId: actor.id,
    actorEmail: actor.email,
    targetType: "seller",
    targetId: created.seller.id,
    metadata: {
      userId: created.id,
      verificationStatus: "UNVERIFIED",
      verificationCodeSent,
    },
  });

  return {
    userId: created.id,
    sellerId: created.seller.id,
    businessName,
    email,
    verificationCodeSent,
  };
}

/** Re-send the email verification code for an already-created seller account. */
export async function resendAdminSellerInvitation(emailInput: string): Promise<boolean> {
  const email = emailInput.trim().toLowerCase();
  const seller = await prisma.seller.findFirst({
    where: { user: { email, authUserId: { not: null } } },
    select: { user: { select: { email: true } } },
  });
  if (!seller) throw new SellerOnboardingError("Seller account not found.");

  const result = await providerSendVerificationCode({ email: seller.user.email });
  return result.failure === null && result.data === true;
}
