import "server-only";

import { Prisma } from "@prisma/client";
import type { CampaignStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/services/audit-service";
import { AdminServiceError, type AdminActor } from "@/services/admin-service";
import type { CampaignCreateInput } from "@/lib/validations/campaign";

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
