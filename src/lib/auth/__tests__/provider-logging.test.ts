import { before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";

const SYNTHETIC_SECRET = "synthetic-cookie-or-password-value";
let mode: "throw" | "provider-error" = "throw";
mock.module("@neondatabase/auth/next/server", {
  namedExports: {
    createNeonAuth: () => ({
      signIn: {
        email: async () => {
          if (mode === "throw") throw new Error(SYNTHETIC_SECRET);
          return { error: { message: SYNTHETIC_SECRET, code: SYNTHETIC_SECRET, statusText: SYNTHETIC_SECRET, status: 500 } };
        },
      },
    }),
  },
});
let neon: typeof import("@/lib/auth/neon");
before(async () => {
  process.env.NEON_AUTH_BASE_URL = "https://auth.example.test";
  process.env.NEON_AUTH_COOKIE_SECRET = "synthetic-cookie-signing-value-0123456789";
  neon = await import("@/lib/auth/neon");
});

describe("Neon Auth failure logging", () => {
  it("does not log or return untrusted provider errors or exception messages", async () => {
    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { logged.push(args); };
    try {
      for (const scenario of ["throw", "provider-error"] as const) {
        mode = scenario;
        neon.resetNeonAuthCache();
        const result = await neon.providerSignIn({ email: "person@example.test", password: SYNTHETIC_SECRET });
        assert.equal(result.data, null);
        assert.equal(JSON.stringify(result).includes(SYNTHETIC_SECRET), false);
      }
      assert.ok(logged.length >= 2);
      assert.equal(JSON.stringify(logged).includes(SYNTHETIC_SECRET), false);
    } finally {
      console.error = original;
    }
  });
});
