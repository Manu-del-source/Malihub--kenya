import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRevenuePreset, resolveRevenueRange } from "../date-range";

const NOW = new Date("2026-11-15T10:00:00Z"); // 13:00 EAT, Sunday
const iso = (d: Date) => d.toISOString();

describe("resolveRevenueRange (EAT, half-open)", () => {
  it("today", () => {
    const r = resolveRevenueRange("today", NOW);
    assert.equal(iso(r.from), "2026-11-14T21:00:00.000Z");
    assert.equal(iso(r.to), "2026-11-15T21:00:00.000Z");
  });
  it("last 7 days includes today and the 6 days before it", () => {
    const r = resolveRevenueRange("last7", NOW);
    assert.equal(iso(r.from), "2026-11-08T21:00:00.000Z");
    assert.equal(iso(r.to), "2026-11-15T21:00:00.000Z");
  });
  it("last 30 days", () => {
    const r = resolveRevenueRange("last30", NOW);
    assert.equal((r.to.getTime() - r.from.getTime()) / 86_400_000, 30);
  });
  it("this month and previous month", () => {
    const t = resolveRevenueRange("thisMonth", NOW);
    assert.equal(iso(t.from), "2026-10-31T21:00:00.000Z");
    assert.equal(iso(t.to), "2026-11-30T21:00:00.000Z");
    const p = resolveRevenueRange("previousMonth", NOW);
    assert.equal(iso(p.from), "2026-09-30T21:00:00.000Z");
    assert.equal(iso(p.to), "2026-10-31T21:00:00.000Z");
  });
  it("uses the Kenyan calendar day: 22:00Z on Nov 30 is already December", () => {
    const r = resolveRevenueRange("thisMonth", new Date("2026-11-30T22:00:00Z"));
    assert.equal(iso(r.from), "2026-11-30T21:00:00.000Z");
  });
  it("previous month crosses a year boundary", () => {
    const r = resolveRevenueRange("previousMonth", new Date("2027-01-10T10:00:00Z"));
    assert.equal(iso(r.from), "2026-11-30T21:00:00.000Z");
    assert.equal(iso(r.to), "2026-12-31T21:00:00.000Z");
  });
  it("custom range is inclusive of the end date", () => {
    const r = resolveRevenueRange("custom", NOW, { from: "2026-11-01", to: "2026-11-03" });
    assert.equal(iso(r.from), "2026-10-31T21:00:00.000Z");
    assert.equal(iso(r.to), "2026-11-03T21:00:00.000Z");
    assert.equal(r.error, undefined);
  });
  it("rejects bad, reversed, impossible and oversized custom ranges with a safe default", () => {
    for (const custom of [
      { from: "nope", to: "2026-11-03" },
      { from: "2026-11-05", to: "2026-11-03" },
      { from: "2026-02-31", to: "2026-03-01" },
      { from: "2024-01-01", to: "2026-11-03" },
      {},
    ]) {
      const r = resolveRevenueRange("custom", NOW, custom);
      assert.ok(r.error, JSON.stringify(custom));
      assert.equal(r.preset, "last30");
    }
  });
  it("falls back to last30 for unknown presets", () => {
    assert.equal(parseRevenuePreset("whatever"), "last30");
    assert.equal(parseRevenuePreset(["today"]), "today");
  });
});
