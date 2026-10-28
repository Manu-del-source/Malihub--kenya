import assert from "node:assert/strict";
import test from "node:test";
import { campaignDateInputValue, campaignDateRange } from "@/lib/validations/campaign";

test("campaign calendar dates use Kenya time, including the full end date", () => {
  const range = campaignDateRange("2026-10-20", "2026-10-22");
  assert.equal(range.startsAt.toISOString(), "2026-10-19T21:00:00.000Z");
  assert.equal(range.endsAt.toISOString(), "2026-10-22T20:59:59.999Z");
});

test("campaign date input displays the stored Kenya calendar date", () => {
  assert.equal(campaignDateInputValue(new Date("2026-10-19T21:00:00.000Z")), "2026-10-20");
  assert.equal(campaignDateInputValue(new Date("2026-10-22T20:59:59.999Z")), "2026-10-22");
});
