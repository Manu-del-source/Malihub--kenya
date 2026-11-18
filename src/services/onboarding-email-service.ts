import "server-only";

import { prisma } from "@/lib/prisma";
import { logServerError } from "@/lib/safe-log";
import { sendEmail } from "@/services/email-service";
import { WelcomeEmail } from "@/emails/welcome-email";
import type { OnboardingEmailKind } from "@prisma/client";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.malihubke.online").replace(/\/$/, "");
const CLAIM_STALE_AFTER_MS = 10 * 60 * 1000;

/**
 * Claims and sends one onboarding email. The unique (user, kind) ledger row
 * prevents duplicate messages; failed sends and abandoned stale claims can be
 * retried without blocking registration or seller activation.
 */
export async function sendOnboardingWelcomeEmail(userId: string, kind: OnboardingEmailKind): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, profile: { select: { fullName: true } }, seller: { select: { businessName: true } } },
    });
    if (!user?.email) return;

    const ledger = await prisma.onboardingEmail.upsert({
      where: { userId_kind: { userId, kind } },
      create: { userId, kind, status: "PENDING" },
      update: {},
      select: { id: true, status: true },
    });
    if (ledger.status === "SENT") return;

    const now = new Date();
    const staleBefore = new Date(now.getTime() - CLAIM_STALE_AFTER_MS);
    const claim = await prisma.onboardingEmail.updateMany({
      where: { id: ledger.id, OR: [{ status: "PENDING" }, { status: "FAILED" }, { status: "PROCESSING", claimedAt: { lt: staleBefore } }] },
      data: { status: "PROCESSING", claimedAt: now, attempts: { increment: 1 }, lastError: null },
    });
    if (claim.count !== 1) return;

    const isSeller = kind === "SELLER_WELCOME";
    const displayName = user.profile?.fullName?.trim().split(/\s+/)[0] || "there";
    const delivered = await sendEmail({
      to: user.email,
      subject: isSeller ? "Welcome to MaliHub Seller Center" : "Welcome to MaliHub Kenya",
      react: WelcomeEmail({ audience: isSeller ? "seller" : "buyer", displayName, shopName: user.seller?.businessName, email: user.email, appUrl: APP_URL }),
    });

    await prisma.onboardingEmail.update({
      where: { id: ledger.id },
      data: delivered
        ? { status: "SENT", sentAt: new Date(), claimedAt: null, lastError: null }
        : { status: "FAILED", claimedAt: null, lastError: "Email provider did not confirm delivery." },
    });
  } catch (error) {
    logServerError("[onboarding-email] Welcome email could not be processed", error);
  }
}

/** Retry failed welcome messages on a later authenticated request. SENT rows are never sent again. */
export async function retryOnboardingWelcomeEmails(userId: string): Promise<void> {
  try {
    // Only retry rows created by a real registration/activation event. Do not
    // backfill welcome emails to the existing user base after this feature ships.
    const buyerDelivery = await prisma.onboardingEmail.findUnique({
      where: { userId_kind: { userId, kind: "BUYER_WELCOME" } },
      select: { status: true },
    });
    if (buyerDelivery && buyerDelivery.status !== "SENT") {
      await sendOnboardingWelcomeEmail(userId, "BUYER_WELCOME");
    }

    const sellerDelivery = await prisma.onboardingEmail.findUnique({
      where: { userId_kind: { userId, kind: "SELLER_WELCOME" } },
      select: { status: true },
    });
    if (sellerDelivery && sellerDelivery.status !== "SENT") {
      await sendOnboardingWelcomeEmail(userId, "SELLER_WELCOME");
    }
  } catch (error) {
    // Email retry is ancillary and must never make a valid sign-in fail.
    logServerError("[onboarding-email] Failed to inspect retryable welcome emails", error);
  }
}