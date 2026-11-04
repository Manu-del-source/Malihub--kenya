import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

mock.module("server-only", { exports: {} });

test("session idle timeout policy", async (t) => {
  const { isSessionIdleExpired, SESSION_IDLE_TIMEOUT_MS } = await import("./session-activity");

  await t.test("session remains active just before the 30-minute idle boundary", () => {
    const now = new Date("2026-10-30T12:30:00.000Z");
    const lastActivity = new Date(now.getTime() - SESSION_IDLE_TIMEOUT_MS + 1);
    assert.equal(isSessionIdleExpired(lastActivity, now), false);
  });

  await t.test("session expires at the 30-minute idle boundary", () => {
    const now = new Date("2026-10-30T12:30:00.000Z");
    const lastActivity = new Date(now.getTime() - SESSION_IDLE_TIMEOUT_MS);
    assert.equal(isSessionIdleExpired(lastActivity, now), true);
  });

  await t.test("session expires after the 30-minute idle boundary", () => {
    const now = new Date("2026-10-30T12:30:00.000Z");
    const lastActivity = new Date(now.getTime() - SESSION_IDLE_TIMEOUT_MS - 1);
    assert.equal(isSessionIdleExpired(lastActivity, now), true);
  });
});
