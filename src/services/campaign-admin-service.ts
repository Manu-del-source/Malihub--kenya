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
  return prisma.campaign.findMany({
    orderBy: [{ createdAt: "desc" }],
    include: { _count: { select: { products: true } } },
  });
}

export async function createAdminCampaign(input: CampaignCreateInput, actor: AdminActor) {
  const now = new Date();
  const status: CampaignStatus = input.startsAt > now ? "SCHEDULED" : "DRAFT";

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
  await refreshCampaignLifecycle(now);
  return prisma.campaign.findMany({
    where: {
      status: "ACTIVE",
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
  await refreshCampaignLifecycle(now);
  return prisma.campaign.findFirst({
    where: {
      slug,
      status: "ACTIVE",
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
