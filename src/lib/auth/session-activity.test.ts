import test from "node:test";
import assert from "node:assert/strict";
import { isSessionIdleExpired, SESSION_IDLE_TIMEOUT_MS } from "./session-activity";

test("session remains active just before the 30-minute idle boundary", () => {
  const now = new Date("2026-10-30T12:30:00.000Z");
  const lastActivity = new Date(now.getTime() - SESSION_IDLE_TIMEOUT_MS + 1);
  assert.equal(isSessionIdleExpired(lastActivity, now), false);
});

test("session expires at the 30-minute idle boundary", () => {
  const now = new Date("2026-10-30T12:30:00.000Z");
  const lastActivity = new Date(now.getTime() - SESSION_IDLE_TIMEOUT_MS);
  assert.equal(isSessionIdleExpired(lastActivity, now), true);
});

test("session expires after the 30-minute idle boundary", () => {
  const now = new Date("2026-10-30T12:30:00.000Z");
  const lastActivity = new Date(now.getTime() - SESSION_IDLE_TIMEOUT_MS - 1);
  assert.equal(isSessionIdleExpired(lastActivity, now), true);
});
