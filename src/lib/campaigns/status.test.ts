import assert from "node:assert/strict";
import test from "node:test";
import { CampaignStatus } from "@prisma/client";
import { resolveCampaignStatus } from "@/lib/campaigns/status";

const now = new Date("2026-10-28T12:00:00.000Z");

test("draft remains hidden regardless of dates", () => {
  assert.equal(
    resolveCampaignStatus(CampaignStatus.DRAFT, new Date("2026-01-01T00:00:00Z"), new Date("2027-01-01T00:00:00Z"), now),
    CampaignStatus.DRAFT,
  );
});

test("cancelled campaign remains hidden regardless of dates", () => {
  assert.equal(
    resolveCampaignStatus(CampaignStatus.CANCELLED, new Date("2026-01-01T00:00:00Z"), new Date("2027-01-01T00:00:00Z"), now),
    CampaignStatus.CANCELLED,
  );
});

test("published campaign with future start is scheduled", () => {
  assert.equal(
    resolveCampaignStatus(CampaignStatus.ACTIVE, new Date("2026-10-29T00:00:00Z"), new Date("2026-11-01T00:00:00Z"), now),
    CampaignStatus.SCHEDULED,
  );
});

test("published campaign inside its date range is active", () => {
  assert.equal(
    resolveCampaignStatus(CampaignStatus.SCHEDULED, new Date("2026-10-27T00:00:00Z"), new Date("2026-10-29T00:00:00Z"), now),
    CampaignStatus.ACTIVE,
  );
});

test("campaign ending exactly now is ended", () => {
  assert.equal(
    resolveCampaignStatus(CampaignStatus.ACTIVE, new Date("2026-10-27T00:00:00Z"), now, now),
    CampaignStatus.ENDED,
  );
});

test("campaign with an expired end date is ended even if requested active", () => {
  assert.equal(
    resolveCampaignStatus(CampaignStatus.ACTIVE, new Date("2026-10-01T00:00:00Z"), new Date("2026-10-28T11:59:59.999Z"), now),
    CampaignStatus.ENDED,
  );
});
