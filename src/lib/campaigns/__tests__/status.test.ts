import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CampaignStatus } from "@prisma/client";
import { resolveCampaignStatus } from "@/lib/campaigns/status";
import { campaignDateInputValue, campaignDateRange, campaignFormSchema } from "@/lib/validations/campaign";

const productId = "a1b2c3d4-e5f6-4789-8123-123456789abc";

describe("campaign status reconciliation", () => {
  const now = new Date("2026-10-28T09:00:00.000+03:00");

  it("keeps drafts and cancellations hidden regardless of dates", () => {
    assert.equal(resolveCampaignStatus(CampaignStatus.DRAFT, new Date("2026-10-01"), new Date("2026-11-01"), now), CampaignStatus.DRAFT);
    assert.equal(resolveCampaignStatus(CampaignStatus.CANCELLED, new Date("2026-10-01"), new Date("2026-11-01"), now), CampaignStatus.CANCELLED);
  });

  it("schedules a published campaign before its start date", () => {
    assert.equal(resolveCampaignStatus(CampaignStatus.ACTIVE, new Date("2026-11-01"), new Date("2026-11-10"), now), CampaignStatus.SCHEDULED);
  });

  it("activates a published campaign only inside its date range", () => {
    assert.equal(resolveCampaignStatus(CampaignStatus.SCHEDULED, new Date("2026-10-01"), new Date("2026-11-01"), now), CampaignStatus.ACTIVE);
  });

  it("ends a published campaign after its end date", () => {
    assert.equal(resolveCampaignStatus(CampaignStatus.ACTIVE, new Date("2026-10-01"), new Date("2026-10-20"), now), CampaignStatus.ENDED);
  });
});

describe("campaign form validation and Kenya date boundaries", () => {
  const valid = {
    title: "Mashujaa Week Finds",
    slug: "mashujaa-week-finds",
    description: "Seasonal listings from verified sellers.",
    startDate: "2026-10-17",
    endDate: "2026-10-24",
    status: CampaignStatus.SCHEDULED,
    productIds: [productId, productId],
  };

  it("deduplicates product ids before saving", () => {
    const parsed = campaignFormSchema.safeParse(valid);
    assert.equal(parsed.success, true);
    if (parsed.success) assert.deepEqual(parsed.data.productIds, [productId]);
  });

  it("rejects an end date before the start date", () => {
    const parsed = campaignFormSchema.safeParse({ ...valid, startDate: "2026-10-24", endDate: "2026-10-17" });
    assert.equal(parsed.success, false);
  });

  it("requires at least one product", () => {
    const parsed = campaignFormSchema.safeParse({ ...valid, productIds: [] });
    assert.equal(parsed.success, false);
  });

  it("stores date-only inputs as Kenya-local calendar boundaries", () => {
    const range = campaignDateRange("2026-10-17", "2026-10-24");
    assert.equal(range.startsAt.toISOString(), "2026-10-16T21:00:00.000Z");
    assert.equal(range.endsAt.toISOString(), "2026-10-24T20:59:59.999Z");
  });
});


describe("campaign date input formatting", () => {
  it("displays stored timestamps as Kenya calendar dates", () => {
    assert.equal(campaignDateInputValue(new Date("2026-10-16T21:00:00.000Z")), "2026-10-17");
    assert.equal(campaignDateInputValue(new Date("2026-10-24T20:59:59.999Z")), "2026-10-24");
  });
});
