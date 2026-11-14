import { afterEach, before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

/**
 * Production fail-closed behaviour for two guards:
 *  - money-moving rate limiters deny when Redis is unavailable;
 *  - the CSRF guard refuses to derive its trusted origin from the Host header.
 */

mock.module("server-only", { namedExports: {} });

const env = process.env as Record<string, string | undefined>;
const saved = { ...env };

function setEnv(values: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
}

afterEach(() => {
  for (const k of ["NODE_ENV", "NEXT_PUBLIC_APP_URL"]) {
    if (saved[k] === undefined) delete env[k];
    else env[k] = saved[k];
  }
});

describe("rate limiter without Redis", () => {
  let rateLimit: typeof import("../rate-limit").rateLimit;

  before(async () => {
    mock.module("@/lib/redis", { namedExports: { getRedis: () => null } });
    ({ rateLimit } = await import("../rate-limit"));
  });

  it("denies payment/order limiters in production", async () => {
    setEnv({ NODE_ENV: "production" });
    for (const r of [
      await rateLimit.paymentInitiate("u"),
      await rateLimit.orderCreate("u"),
      await rateLimit.paymentStatusCheck("u"),
    ]) {
      assert.equal(r.success, false);
    }
  });

  it("allows them outside production", async () => {
    setEnv({ NODE_ENV: "development" });
    assert.equal((await rateLimit.paymentInitiate("u")).success, true);
  });

  it("keeps the other limiters fail-open", async () => {
    setEnv({ NODE_ENV: "production" });
    assert.equal((await rateLimit.cartMutate("u")).success, true);
  });
});

describe("verifySameOrigin", () => {
  const req = (origin: string) =>
    new NextRequest("https://evil.test/api/x", {
      method: "POST",
      headers: { origin, host: "evil.test" },
    });

  it("returns 503 in production when NEXT_PUBLIC_APP_URL is unset", async () => {
    setEnv({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: undefined });
    const { verifySameOrigin } = await import("../csrf");
    const res = verifySameOrigin(req("https://evil.test"));
    assert.equal(res?.status, 503);
  });

  it("still enforces the configured origin", async () => {
    setEnv({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://app.malihub.test" });
    const { verifySameOrigin } = await import("../csrf");
    assert.equal(verifySameOrigin(req("https://evil.test"))?.status, 403);
    assert.equal(verifySameOrigin(req("https://app.malihub.test")), null);
  });
});
