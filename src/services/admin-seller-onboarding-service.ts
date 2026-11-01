import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  providerSendVerificationCode,
  providerSendVerificationEmail,
  providerSignUp,
} from "@/lib/auth/neon";
import { isVerificationEmailDisabled } from "@/lib/auth/errors";
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

const INVITATION_TTL_MS = 24 * 60 * 60 * 1000;

function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function appOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) {
    throw new SellerOnboardingError("NEXT_PUBLIC_APP_URL must be configured before seller onboarding.");
  }
  try {
    const parsed = new URL(configured);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Invalid protocol");
    return parsed.origin;
  } catch {
    throw new SellerOnboardingError("NEXT_PUBLIC_APP_URL must be a valid absolute HTTP or HTTPS URL.");
  }
}

function createInvitation(): { token: string; tokenHash: string; expiresAt: Date } {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashInvitationToken(token),
    expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
  };
}

function invitationUrl(token: string): string {
  return `${appOrigin()}/seller/activate?token=${encodeURIComponent(token)}`;
}

/**
 * Admin-created seller records are deliberately created WITHOUT a Neon Auth
 * identity. The seller's one-time invitation is the only path that creates the
 * credential account, so the seller chooses the password themselves.
 */
export async function createAdminSellerAccount(
  input: CreateAdminSellerInput,
  actor: { id: string; email: string }
): Promise<{
  userId: string;
  sellerId: string;
  businessName: string;
  email: string;
  activationUrl: string;
  expiresAt: string;
}> {
  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim();
  const businessName = input.businessName.trim();
  const county = input.county.trim();
  const origin = appOrigin();

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    throw new SellerOnboardingError(
      "A MaliHub account already uses this email. Use the existing account instead of creating a duplicate."
    );
  }

  const userId = randomUUID();
  const baseSlug = slugify(businessName) || "seller";
  const existingSlug = await prisma.seller.findUnique({ where: { slug: baseSlug }, select: { id: true } });
  const sellerSlug = existingSlug ? `${baseSlug}-${userId.slice(0, 6)}` : baseSlug;
  const invitation = createInvitation();

  let created: { id: string; seller: { id: string } | null };
  try {
    created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          id: userId,
          authUserId: null,
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

      await tx.sellerInvitationToken.create({
        data: {
          userId: user.id,
          tokenHash: invitation.tokenHash,
          expiresAt: invitation.expiresAt,
        },
      });
      return user;
    });
  } catch (error) {
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

  await logAuditEvent({
    action: "admin.seller_created",
    actorId: actor.id,
    actorEmail: actor.email,
    targetType: "seller",
    targetId: created.seller.id,
    metadata: {
      userId: created.id,
      verificationStatus: "UNVERIFIED",
      invitationMethod: "manual_one_time_link",
      invitationExpiresAt: invitation.expiresAt.toISOString(),
    },
  });

  return {
    userId: created.id,
    sellerId: created.seller.id,
    businessName,
    email,
    activationUrl: `${origin}/seller/activate?token=${encodeURIComponent(invitation.token)}`,
    expiresAt: invitation.expiresAt.toISOString(),
  };
}

/**
 * Rotate a pending seller's invitation. For legacy accounts that already have
 * a Neon identity, retain the old email-verification resend path so existing
 * sellers are not stranded by this migration.
 */
export async function resendAdminSellerInvitation(
  emailInput: string
): Promise<
  | { method: "invitation"; activationUrl: string; expiresAt: string }
  | { method: "verification-link" | "code" }
> {
  const email = emailInput.trim().toLowerCase();
  const seller = await prisma.seller.findFirst({
    where: { user: { email } },
    select: {
      user: {
        select: {
          id: true,
          email: true,
          authUserId: true,
        },
      },
    },
  });
  if (!seller) throw new SellerOnboardingError("Seller account not found.");

  if (!seller.user.authUserId) {
    const invitation = createInvitation();
    await prisma.sellerInvitationToken.upsert({
      where: { userId: seller.user.id },
      create: {
        userId: seller.user.id,
        tokenHash: invitation.tokenHash,
        expiresAt: invitation.expiresAt,
      },
      update: {
        tokenHash: invitation.tokenHash,
        expiresAt: invitation.expiresAt,
        claimedAt: null,
        consumedAt: null,
      },
    });
    return {
      method: "invitation",
      activationUrl: invitationUrl(invitation.token),
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  const origin = appOrigin();
  const linkAttempt = await providerSendVerificationEmail({
    email: seller.user.email,
    callbackURL: `${origin}/login?verified=1`,
  });
  if (linkAttempt.failure === null) return { method: "verification-link" };
  if (!isVerificationEmailDisabled(linkAttempt.failure)) {
    throw new SellerOnboardingError(linkAttempt.failure.message);
  }

  const codeAttempt = await providerSendVerificationCode({ email: seller.user.email });
  if (codeAttempt.failure) throw new SellerOnboardingError(codeAttempt.failure.message);
  return { method: "code" };
}

/** Server-side lookup used only to render the password setup screen. */
export async function getSellerInvitationDetails(token: string): Promise<{
  email: string;
  fullName: string;
  businessName: string;
} | null> {
  if (!token || token.length > 256) return null;
  const invitation = await prisma.sellerInvitationToken.findFirst({
    where: {
      tokenHash: hashInvitationToken(token),
      expiresAt: { gt: new Date() },
      claimedAt: null,
      consumedAt: null,
    },
    select: {
      user: {
        select: {
          email: true,
          profile: { select: { fullName: true } },
          seller: { select: { businessName: true } },
        },
      },
    },
  });
  if (!invitation?.user.profile || !invitation.user.seller) return null;
  return {
    email: invitation.user.email,
    fullName: invitation.user.profile.fullName,
    businessName: invitation.user.seller.businessName,
  };
}

/**
 * Redeem a manual invitation and create the Neon Auth credential using the
 * seller-chosen password. Neon Auth remains responsible for email verification;
 * this action never marks an email verified or creates a privileged session.
 */
export async function activateSellerInvitation(input: {
  token: string;
  password: string;
}): Promise<{ email: string }> {
  const token = input.token.trim();
  if (!token || token.length > 256) {
    throw new SellerOnboardingError("This invitation link is invalid or has expired. Ask the admin for a new link.");
  }

  const tokenHash = hashInvitationToken(token);
  const invitation = await prisma.sellerInvitationToken.findFirst({
    where: {
      tokenHash,
      expiresAt: { gt: new Date() },
      claimedAt: null,
      consumedAt: null,
    },
    include: {
      user: { select: { id: true, email: true, profile: { select: { fullName: true } } } },
    },
  });
  if (!invitation?.user.profile) {
    throw new SellerOnboardingError("This invitation link is invalid or has expired. Ask the admin for a new link.");
  }

  const claimedAt = new Date();
  const claim = await prisma.sellerInvitationToken.updateMany({
    where: {
      id: invitation.id,
      tokenHash,
      expiresAt: { gt: claimedAt },
      claimedAt: null,
      consumedAt: null,
    },
    data: { claimedAt },
  });
  if (claim.count !== 1) {
    throw new SellerOnboardingError("This invitation has already been used or is being activated. Ask the admin for a new link if needed.");
  }

  const identity = await providerSignUp({
    email: invitation.user.email,
    password: input.password,
    name: invitation.user.profile.fullName,
  });

  if (!identity.data) {
    await prisma.sellerInvitationToken.updateMany({
      where: { id: invitation.id, claimedAt, consumedAt: null },
      data: { claimedAt: null },
    });
    throw new SellerOnboardingError(
      identity.failure?.message ?? "We couldn't create your sign-in account. Please try again."
    );
  }

  try {
    await prisma.$transaction(async (tx) => {
      const linked = await tx.user.updateMany({
        where: { id: invitation.user.id, authUserId: null },
        data: { authUserId: identity.data!.authUserId, emailVerified: false },
      });
      if (linked.count !== 1) throw new Error("Seller identity was already linked.");

      const consumed = await tx.sellerInvitationToken.updateMany({
        where: { id: invitation.id, claimedAt, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1) throw new Error("Seller invitation could not be consumed.");
    });
  } catch (error) {
    logServerError("[seller-invitation] Neon identity created but local linking failed", error);
    throw new SellerOnboardingError(
      "Your sign-in account was created, but we couldn't finish linking it. Contact MaliHub support before trying another invitation."
    );
  }

  return { email: invitation.user.email };
}
