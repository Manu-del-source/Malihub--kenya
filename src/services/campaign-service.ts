import "server-only";

import { CampaignStatus, ListingStatus, SellerVerificationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/services/audit-service";

export class CampaignServiceError extends Error {}

export type CampaignActor = { id: string; email: string };

export type CampaignWriteInput = {
  title: string;
  slug: string;
  description?: string;
  startsAt: Date;
  endsAt: Date;
  status: CampaignStatus;
  productIds: string[];
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function resolveCampaignStatus(
  requested: CampaignStatus,
  startsAt: Date,
  endsAt: Date,
  now = new Date(),
): CampaignStatus {
  if (requested === CampaignStatus.DRAFT || requested === CampaignStatus.CANCELLED) return requested;
  if (endsAt.getTime() <= now.getTime()) return CampaignStatus.ENDED;
  if (startsAt.getTime() > now.getTime()) return CampaignStatus.SCHEDULED;
  return CampaignStatus.ACTIVE;
}

function validateDateRange(startsAt: Date, endsAt: Date) {
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime())) {
    throw new CampaignServiceError("Choose valid campaign dates.");
  }
  if (endsAt.getTime() < startsAt.getTime()) {
    throw new CampaignServiceError("The campaign end date must not be before its start date.");
  }
}

async function assertEligibleProducts(tx: { product: typeof prisma.product }, productIds: string[]) {
  const uniqueIds = [...new Set(productIds)];
  if (uniqueIds.length === 0) throw new CampaignServiceError("Choose at least one eligible product.");

  const eligible = await tx.product.findMany({
    where: {
      id: { in: uniqueIds },
      status: ListingStatus.ACTIVE,
      seller: { verificationStatus: SellerVerificationStatus.VERIFIED },
    },
    select: { id: true },
  });

  if (eligible.length !== uniqueIds.length) {
    throw new CampaignServiceError("Only active listings from verified sellers can be added to a campaign.");
  }
  return uniqueIds;
}

function mapWriteError(error: unknown): never {
  if ((error as { code?: string })?.code === "P2002") {
    throw new CampaignServiceError("That campaign slug is already in use.");
  }
  if ((error as { code?: string })?.code === "P2025") {
    throw new CampaignServiceError("That campaign no longer exists.");
  }
  throw error;
}

export async function listAdminCampaigns() {
  return prisma.campaign.findMany({
    orderBy: [{ createdAt: "desc" }],
    include: {
      products: {
        orderBy: { sortOrder: "asc" },
        include: {
          product: {
            select: {
              id: true,
              title: true,
              slug: true,
              status: true,
              seller: { select: { businessName: true, verificationStatus: true } },
            },
          },
        },
      },
    },
  });
}

export async function getAdminCampaignById(id: string) {
  if (!UUID_RE.test(id)) return null;
  return prisma.campaign.findUnique({
    where: { id },
    include: {
      products: {
        orderBy: { sortOrder: "asc" },
        include: {
          product: {
            select: {
              id: true,
              title: true,
              slug: true,
              status: true,
              seller: { select: { businessName: true, verificationStatus: true } },
            },
          },
        },
      },
    },
  });
}

export async function listCampaignProductOptions() {
  return prisma.product.findMany({
    where: {
      status: ListingStatus.ACTIVE,
      seller: { verificationStatus: SellerVerificationStatus.VERIFIED },
    },
    orderBy: [{ title: "asc" }],
    take: 200,
    select: {
      id: true,
      title: true,
      slug: true,
      priceCents: true,
      seller: { select: { businessName: true } },
    },
  });
}

export async function createCampaign(input: CampaignWriteInput, actor: CampaignActor) {
  validateDateRange(input.startsAt, input.endsAt);
  const status = resolveCampaignStatus(input.status, input.startsAt, input.endsAt);

  try {
    const campaign = await prisma.$transaction(async (tx) => {
      const productIds = await assertEligibleProducts(tx, input.productIds);
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
            create: productIds.map((productId, sortOrder) => ({
              sortOrder,
              product: { connect: { id: productId } },
            })),
          },
        },
        include: { products: { select: { productId: true } } },
      });
    });

    await logAuditEvent({
      action: "admin.campaign_created",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "campaign",
      targetId: campaign.id,
      metadata: { slug: campaign.slug, status: campaign.status, productCount: campaign.products.length },
    });
    return campaign;
  } catch (error) {
    return mapWriteError(error);
  }
}

export async function updateCampaign(id: string, input: CampaignWriteInput, actor: CampaignActor) {
  if (!UUID_RE.test(id)) throw new CampaignServiceError("Invalid campaign id.");
  validateDateRange(input.startsAt, input.endsAt);
  const status = resolveCampaignStatus(input.status, input.startsAt, input.endsAt);

  try {
    const campaign = await prisma.$transaction(async (tx) => {
      const productIds = await assertEligibleProducts(tx as typeof prisma, input.productIds);
      return tx.campaign.update({
        where: { id },
        data: {
          title: input.title,
          slug: input.slug,
          description: input.description,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          status,
          products: {
            deleteMany: {},
            create: productIds.map((productId, sortOrder) => ({
              sortOrder,
              product: { connect: { id: productId } },
            })),
          },
        },
        include: { products: { select: { productId: true } } },
      });
    });

    await logAuditEvent({
      action: "admin.campaign_updated",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "campaign",
      targetId: campaign.id,
      metadata: { slug: campaign.slug, status: campaign.status, productCount: campaign.products.length },
    });
    return campaign;
  } catch (error) {
    return mapWriteError(error);
  }
}

export async function deleteCampaign(id: string, actor: CampaignActor) {
  if (!UUID_RE.test(id)) throw new CampaignServiceError("Invalid campaign id.");
  const existing = await prisma.campaign.findUnique({ where: { id }, select: { id: true, slug: true, title: true } });
  if (!existing) throw new CampaignServiceError("That campaign no longer exists.");

  try {
    await prisma.campaign.delete({ where: { id } });
  } catch (error) {
    return mapWriteError(error);
  }

  await logAuditEvent({
    action: "admin.campaign_deleted",
    actorId: actor.id,
    actorEmail: actor.email,
    targetType: "campaign",
    targetId: existing.id,
    metadata: { slug: existing.slug, title: existing.title },
  });
  return { id: existing.id };
}

const publicProductFilter = {
  status: ListingStatus.ACTIVE,
  seller: { verificationStatus: SellerVerificationStatus.VERIFIED },
} as const;

export async function listPublicCampaigns(now = new Date()) {
  return prisma.campaign.findMany({
    where: {
      status: CampaignStatus.ACTIVE,
      startsAt: { lte: now },
      endsAt: { gt: now },
      products: { some: { product: publicProductFilter } },
    },
    orderBy: [{ startsAt: "desc" }, { title: "asc" }],
    include: {
      products: {
        where: { product: publicProductFilter },
        orderBy: { sortOrder: "asc" },
        include: {
          product: {
            select: {
              id: true,
              title: true,
              slug: true,
              priceCents: true,
              county: true,
              images: { where: { isPrimary: true }, take: 1, select: { url: true } },
              seller: { select: { businessName: true, slug: true } },
            },
          },
        },
      },
    },
  });
}

export async function getPublicCampaignBySlug(slug: string, now = new Date()) {
  const campaign = await prisma.campaign.findFirst({
    where: {
      slug,
      status: CampaignStatus.ACTIVE,
      startsAt: { lte: now },
      endsAt: { gt: now },
    },
    include: {
      products: {
        where: { product: publicProductFilter },
        orderBy: { sortOrder: "asc" },
        include: {
          product: {
            select: {
              id: true,
              title: true,
              slug: true,
              priceCents: true,
              county: true,
              images: { where: { isPrimary: true }, take: 1, select: { url: true } },
              seller: { select: { businessName: true, slug: true } },
            },
          },
        },
      },
    },
  });

  if (!campaign || campaign.products.length === 0) return null;
  return campaign;
}
