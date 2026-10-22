import "server-only";

import { Prisma } from "@prisma/client";
import type { CampaignStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/services/audit-service";
import { AdminServiceError, type AdminActor } from "@/services/admin-service";
import type { CampaignCreateInput } from "@/lib/validations/campaign";

export async function listEligibleCampaignProducts() {
  return prisma.product.findMany({
    where: { status: "ACTIVE", seller: { verificationStatus: "VERIFIED" } },
    select: { id: true, title: true, slug: true, priceCents: true, seller: { select: { businessName: true } } },
    orderBy: [{ createdAt: "desc" }],
    take: 500,
  });
}

export async function listAdminCampaigns() {
  await refreshCampaignLifecycle();
  return prisma.campaign.findMany({
    orderBy: [{ createdAt: "desc" }],
    include: { _count: { select: { products: true } }, products: { select: { productId: true } } },
  });
}

export async function createAdminCampaign(input: CampaignCreateInput, actor: AdminActor) {
  const now = new Date();
  const status: CampaignStatus = input.endsAt <= now ? "ENDED" : input.startsAt > now ? "SCHEDULED" : "ACTIVE";

  try {
    const campaign = await prisma.$transaction(async (tx) => {
      if (input.productIds.length) {
        const eligible = await tx.product.count({
          where: {
            id: { in: input.productIds },
            status: "ACTIVE",
            seller: { verificationStatus: "VERIFIED" },
          },
        });
        if (eligible !== input.productIds.length) {
          throw new AdminServiceError(
            "Every campaign product must be an active listing from a verified seller."
          );
        }
      }

      return tx.campaign.create({
        data: {
          title: input.title,
          slug: input.slug,
          description: input.description,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          status,
          createdById: actor.id,
          products: {
            create: input.productIds.map((productId, sortOrder) => ({
              productId,
              sortOrder,
            })),
          },
        },
        include: { _count: { select: { products: true } } },
      });
    });

    await logAuditEvent({
      action: "admin.campaign_created",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "campaign",
      targetId: campaign.id,
      metadata: { slug: campaign.slug, status: campaign.status, productCount: campaign._count.products },
    });
    return campaign;
  } catch (error) {
    if (error instanceof AdminServiceError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AdminServiceError("A campaign with that slug already exists.");
    }
    throw error;
  }
}

export async function setAdminCampaignStatus(
  id: string,
  status: Exclude<CampaignStatus, "ENDED">,
  actor: AdminActor
) {
  const current = await prisma.campaign.findUnique({ where: { id } });
  if (!current) throw new AdminServiceError("Campaign no longer exists.");
  if (current.status === "CANCELLED" && status !== "CANCELLED") {
    throw new AdminServiceError("Cancelled campaigns cannot be reactivated. Create a new campaign instead.");
  }
  if (status === "ACTIVE") {
    const now = new Date();
    if (current.startsAt > now || current.endsAt <= now) {
      throw new AdminServiceError("A campaign can only be activated within its scheduled time window.");
    }
  }
  if (status === "SCHEDULED" && current.startsAt <= new Date()) {
    throw new AdminServiceError("A scheduled campaign must start in the future.");
  }

  const updated = await prisma.campaign.update({
    where: { id },
    data: { status },
  });
  await logAuditEvent({
    action: "admin.campaign_status_changed",
    actorId: actor.id,
    actorEmail: actor.email,
    targetType: "campaign",
    targetId: id,
    metadata: { from: current.status, to: updated.status },
  });
  return updated;
}


/**
 * Bring time-driven campaigns into their effective lifecycle state whenever
 * an admin or public campaign surface is read. Public visibility also checks
 * the actual time window, so stale status cannot expose an expired campaign.
 */
export async function refreshCampaignLifecycle(now = new Date()) {
  await prisma.$transaction([
    prisma.campaign.updateMany({
      where: { status: "SCHEDULED", startsAt: { lte: now }, endsAt: { gt: now } },
      data: { status: "ACTIVE" },
    }),
    prisma.campaign.updateMany({
      where: { status: { in: ["SCHEDULED", "ACTIVE"] }, endsAt: { lte: now } },
      data: { status: "ENDED" },
    }),
  ]);
}

export async function listPublicActiveCampaigns(now = new Date()) {
  return prisma.campaign.findMany({
    where: {
      status: { in: ["ACTIVE", "SCHEDULED"] },
      startsAt: { lte: now },
      endsAt: { gt: now },
      products: {
        some: {
          product: { status: "ACTIVE", seller: { verificationStatus: "VERIFIED" } },
        },
      },
    },
    select: {
      id: true,
      title: true,
      slug: true,
      description: true,
      startsAt: true,
      endsAt: true,
      products: {
        orderBy: { sortOrder: "asc" },
        where: { product: { status: "ACTIVE", seller: { verificationStatus: "VERIFIED" } } },
        select: {
          product: {
            select: {
              id: true, title: true, slug: true, priceCents: true, county: true,
              images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } },
            },
          },
        },
      },
    },
    orderBy: [{ startsAt: "asc" }, { createdAt: "desc" }],
    take: 12,
  });
}

export async function getPublicActiveCampaignBySlug(slug: string, now = new Date()) {
  return prisma.campaign.findFirst({
    where: {
      slug,
      status: { in: ["ACTIVE", "SCHEDULED"] },
      startsAt: { lte: now },
      endsAt: { gt: now },
    },
    select: {
      id: true, title: true, slug: true, description: true, startsAt: true, endsAt: true,
      products: {
        orderBy: { sortOrder: "asc" },
        where: { product: { status: "ACTIVE", seller: { verificationStatus: "VERIFIED" } } },
        select: {
          product: {
            select: {
              id: true, title: true, slug: true, priceCents: true, county: true,
              images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } },
            },
          },
        },
      },
    },
  });
}


export async function updateAdminCampaign(
  input: import("@/lib/validations/campaign").CampaignUpdateInput,
  actor: AdminActor
) {
  const now = new Date();
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.campaign.findUnique({ where: { id: input.id } });
      if (!current) throw new AdminServiceError("Campaign no longer exists.");
      if (current.status === "CANCELLED" || current.status === "ENDED") {
        throw new AdminServiceError("Ended or cancelled campaigns cannot be edited.");
      }
      if (input.productIds.length) {
        const eligible = await tx.product.count({
          where: {
            id: { in: input.productIds },
            status: "ACTIVE",
            seller: { verificationStatus: "VERIFIED" },
          },
        });
        if (eligible !== input.productIds.length) {
          throw new AdminServiceError("Every campaign product must be an active listing from a verified seller.");
        }
      }
      const status: CampaignStatus = current.status === "DRAFT"
        ? "DRAFT"
        : input.endsAt <= now
          ? "ENDED"
          : input.startsAt > now
            ? "SCHEDULED"
            : "ACTIVE";
      await tx.campaignProduct.deleteMany({ where: { campaignId: input.id } });
      return tx.campaign.update({
        where: { id: input.id },
        data: {
          title: input.title,
          slug: input.slug,
          description: input.description,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          status,
          products: { create: input.productIds.map((productId, sortOrder) => ({ productId, sortOrder })) },
        },
        include: { _count: { select: { products: true } } },
      });
    });
    await logAuditEvent({
      action: "admin.campaign_updated",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "campaign",
      targetId: updated.id,
      metadata: { slug: updated.slug, status: updated.status, productCount: updated._count.products },
    });
    return updated;
  } catch (error) {
    if (error instanceof AdminServiceError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AdminServiceError("A campaign with that slug already exists.");
    }
    throw error;
  }
}


/** Permanently remove a campaign and its assignments, never the products themselves. */
export async function deleteAdminCampaign(id: string, actor: AdminActor) {
  const current = await prisma.campaign.findUnique({
    where: { id },
    select: { id: true, title: true, slug: true, status: true, startsAt: true, endsAt: true },
  });
  if (!current) throw new AdminServiceError("Campaign no longer exists.");

  await prisma.$transaction(async (tx) => {
    await tx.campaignProduct.deleteMany({ where: { campaignId: id } });
    await tx.campaign.delete({ where: { id } });
  });

  await logAuditEvent({
    action: "admin.campaign_deleted",
    actorId: actor.id,
    actorEmail: actor.email,
    targetType: "campaign",
    targetId: id,
    metadata: { title: current.title, slug: current.slug, status: current.status, startsAt: current.startsAt.toISOString(), endsAt: current.endsAt.toISOString() },
  });
  return { id: current.id, title: current.title, slug: current.slug };
}
