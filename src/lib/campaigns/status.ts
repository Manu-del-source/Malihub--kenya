import { CampaignStatus } from "@prisma/client";

/**
 * Public visibility is date-gated, never inferred from a client-supplied status.
 * Drafts and cancellations remain hidden; published states are reconciled with
 * the selected Kenya-calendar date range at every admin save.
 */
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
