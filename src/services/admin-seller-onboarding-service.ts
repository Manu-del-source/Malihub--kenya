import "server-only";

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { providerRequestPasswordReset } from "@/lib/auth/neon";
import { logAuditEvent } from "@/services/audit-service";
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

  if (!apiKey || !projectId || !branchId) {
    throw new SellerOnboardingError(
      "Seller invitations are not configured. Add NEON_API_KEY, NEON_PROJECT_ID and NEON_AUTH_BRANCH_ID to the server environment."
    );
  }

  return { apiKey, projectId, branchId };
}

async function createNeonIdentity(input: {
  email: string;
  name: string;
}): Promise<string> {
  const { apiKey, projectId, branchId } = neonManagementConfig();
  const response = await fetch(
    `https://console.neon.tech/api/v2/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/auth/users`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ email: input.email, name: input.name }),
      cache: "no-store",
    }
  );

  if (!response.ok) {
    // Never include the provider response body: it can contain user data.
    if (response.status === 409) {
      throw new SellerOnboardingError(
        "An authentication account with this email already exists. Ask the seller to use Forgot password or contact support."
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
  };
  const authUserId =
    typeof payload.id === "string"
      ? payload.id
      : typeof payload.user?.id === "string"
        ? payload.user.id
        : null;

  if (!authUserId) {
    throw new SellerOnboardingError(
      "Neon Auth created a response without an account ID. Contact support before retrying."
    );
  }

  return authUserId;
}

async function deleteNeonIdentity(authUserId: string): Promise<void> {
  const { apiKey, projectId, branchId } = neonManagementConfig();
  await fetch(
    `https://console.neon.tech/api/v2/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/auth/users/${encodeURIComponent(authUserId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      cache: "no-store",
    }
  );
}

function passwordSetupRedirect(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) {
    throw new SellerOnboardingError(
      "NEXT_PUBLIC_APP_URL must be configured before seller invitations can be sent."
    );
  }
  const url = new URL("/reset-password", configured);
  return url.toString();
}

/**
 * Creates a real Neon Auth identity, maps it to MaliHub's own user UUID, and
 * creates the profile + unverified seller record in one Prisma transaction.
 * No password is generated, requested, returned, or stored by MaliHub.
 */
export async function createAdminSellerAccount(input: CreateAdminSellerInput, actor: {
  id: string;
  email: string;
}): Promise<{
  userId: string;
  sellerId: string;
  businessName: string;
  email: string;
  invitationSent: boolean;
}> {
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

  let created: { id: string; seller: { id: string } };
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
      await deleteNeonIdentity(authUserId);
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

  const invitation = await providerRequestPasswordReset({
    email,
    redirectTo: passwordSetupRedirect(),
  });
  const invitationSent = invitation.failure === null && invitation.data === true;

  await logAuditEvent({
    action: "admin.seller_created",
    actorId: actor.id,
    actorEmail: actor.email,
    targetType: "seller",
    targetId: created.seller.id,
    metadata: {
      userId: created.id,
      verificationStatus: "UNVERIFIED",
      invitationSent,
    },
  });

  return {
    userId: created.id,
    sellerId: created.seller.id,
    businessName,
    email,
    invitationSent,
  };
}

/** Re-send the password setup link for an already-created seller account. */
export async function resendAdminSellerInvitation(emailInput: string): Promise<boolean> {
  const email = emailInput.trim().toLowerCase();
  const seller = await prisma.seller.findFirst({
    where: { user: { email, authUserId: { not: null } } },
    select: { user: { select: { email: true } } },
  });
  if (!seller) throw new SellerOnboardingError("Seller account not found.");

  const result = await providerRequestPasswordReset({
    email: seller.user.email,
    redirectTo: passwordSetupRedirect(),
  });
  return result.failure === null && result.data === true;
}
