import assert from "node:assert/strict";
import test from "node:test";
import {
  campaignCreateSchema,
  campaignStatusActionSchema,
  campaignUpdateSchema,
} from "./campaign";

const valid = {
  title: "Weekend Finds",
  slug: "weekend-finds",
  description: "A curated collection of verified seller products.",
  startsAt: "2026-11-01T08:00:00.000Z",
  endsAt: "2026-11-03T08:00:00.000Z",
  productIds: ["123e4567-e89b-42d3-a456-426614174000"],
};

test("campaign create accepts a valid campaign and parses dates", () => {
  const result = campaignCreateSchema.safeParse(valid);
  assert.equal(result.success, true);
  if (result.success) {
    assert.ok(result.data.startsAt instanceof Date);
    assert.equal(result.data.productIds.length, 1);
  }
});

test("campaign create rejects an end time equal to the start time", () => {
  const result = campaignCreateSchema.safeParse({
    ...valid,
    endsAt: valid.startsAt,
  });
  assert.equal(result.success, false);
});

test("campaign create rejects an end time before the start time", () => {
  const result = campaignCreateSchema.safeParse({
    ...valid,
    endsAt: "2026-10-31T08:00:00.000Z",
  });
  assert.equal(result.success, false);
});

test("campaign slug must be lowercase and URL-safe", () => {
  assert.equal(campaignCreateSchema.safeParse({ ...valid, slug: "Weekend Finds" }).success, false);
  assert.equal(campaignCreateSchema.safeParse({ ...valid, slug: "weekend-finds" }).success, true);
});

test("campaign product IDs must be unique and valid UUIDs", () => {
  const duplicate = valid.productIds[0];
  assert.equal(campaignCreateSchema.safeParse({ ...valid, productIds: [duplicate, duplicate] }).success, false);
  assert.equal(campaignCreateSchema.safeParse({ ...valid, productIds: ["not-a-uuid"] }).success, false);
});

test("campaign update requires a valid campaign UUID", () => {
  assert.equal(campaignUpdateSchema.safeParse({ ...valid, id: "invalid" }).success, false);
  assert.equal(campaignUpdateSchema.safeParse({ ...valid, id: "123e4567-e89b-42d3-a456-426614174000" }).success, true);
});

test("campaign status action accepts only supported admin transitions", () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";
  assert.equal(campaignStatusActionSchema.safeParse({ id, status: "CANCELLED" }).success, true);
  assert.equal(campaignStatusActionSchema.safeParse({ id, status: "ENDED" }).success, false);
  assert.equal(campaignStatusActionSchema.safeParse({ id: "bad", status: "ACTIVE" }).success, false);
});
