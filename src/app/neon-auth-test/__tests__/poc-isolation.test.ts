import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Isolation guard-rails for the Neon Auth POC.
 *
 * The evaluation brief is explicit: the POC must not reach into Supabase, must
 * not touch MaliHub's account provisioning, and must not write to the Prisma
 * schema. Rather than mocking behaviour, this test reads the POC's own source
 * (and the production account-provisioning module) and asserts the separation
 * still holds — so a later edit cannot quietly re-couple the experiment to the
 * production auth path.
 */

const POC_DIRECTORIES = ["src/lib/neon-auth", "src/app/neon-auth-test"];

const FORBIDDEN_IN_POC = [
  // Supabase auth surface — the POC must prove Neon Auth stands alone.
  "@/lib/supabase",
  "supabase.auth",
  "signInWithPassword",
  "exchangeCodeForSession",
  "createServiceRoleClient",
  "app_metadata",
  "NEXT_PUBLIC_SUPABASE",
  // MaliHub account provisioning — out of scope for this experiment.
  "@/services/auth-service",
  "@/services/account-provisioning",
  "ensureUserProvisioned",
  "saveCompletedProfile",
  "completeUserProfile",
  "provisionUserRows",
  "syncSupabaseAppMetadata",
  // The POC's Auth URL must never be exposed to the browser.
  "NEXT_PUBLIC_NEON_AUTH_URL",
];

/** Prisma writes are out of scope: the probe is read-only by design. */
const FORBIDDEN_PRISMA_WRITES = [
  "prisma.user.create",
  "prisma.user.update",
  "prisma.user.upsert",
  "prisma.profile.",
  "prisma.seller.",
  "$transaction",
];

/**
 * Runtime sources only: the test files themselves name the forbidden APIs on
 * purpose (that is how they assert they are absent).
 */
function pocSourceFiles(): string[] {
  return POC_DIRECTORIES.flatMap((directory) =>
    readdirSync(directory, { recursive: true })
      .map((entry) => join(directory, String(entry)))
      .filter((file) => /\.tsx?$/.test(file) && !file.includes("__tests__"))
  );
}

/**
 * Scans code, not prose: the POC's comments explain *why* these APIs are
 * absent, so block comments (which is where those names appear) are stripped
 * before matching.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("Neon Auth POC — isolation guard-rails", () => {
  it("finds the POC sources it is supposed to be guarding", () => {
    const files = pocSourceFiles();
    assert.ok(files.length >= 8, `expected the POC sources, found: ${files.join(", ")}`);
    assert.ok(files.includes("src/lib/neon-auth/server.ts"));
    assert.ok(files.includes("src/app/neon-auth-test/actions.ts"));
  });

  it("never references Supabase, provisioning, or a public Auth URL", () => {
    for (const file of pocSourceFiles()) {
      const source = code(readFileSync(file, "utf8"));
      for (const forbidden of FORBIDDEN_IN_POC) {
        assert.equal(
          source.includes(forbidden),
          false,
          `${file} must not reference "${forbidden}"`
        );
      }
    }
  });

  it("never writes to Prisma — the Neon identity stays unlinked", () => {
    for (const file of pocSourceFiles()) {
      const source = code(readFileSync(file, "utf8"));
      for (const forbidden of FORBIDDEN_PRISMA_WRITES) {
        assert.equal(
          source.includes(forbidden),
          false,
          `${file} must not call "${forbidden}"`
        );
      }
    }
  });

  it("keeps the production auth flow out of the POC's middleware branch", () => {
    const middleware = readFileSync("src/middleware.ts", "utf8");
    const pocReturnIndex = middleware.indexOf("handleNeonAuthPocRequest(request);");
    const supabaseRefreshIndex = middleware.indexOf("await updateSession(request)");

    assert.ok(pocReturnIndex > -1, "expected the POC branch in src/middleware.ts");
    assert.ok(
      pocReturnIndex < supabaseRefreshIndex,
      "the POC branch must return before the Supabase session refresh runs"
    );
  });

  it("does not modify the Prisma schema or add migrations for the POC", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");

    // The identity contract the POC deliberately left untouched: `users.id` is
    // a UUID owned by Supabase today, and the POC added no Neon Auth models.
    assert.match(schema, /model User \{[\s\S]*?id\s+String\s+@id\s+@db\.Uuid/);
    assert.equal(
      /model\s+(Neon|BetterAuth|NeonAuth)/.test(schema),
      false,
      "the POC must not introduce an auth model into prisma/schema.prisma"
    );

    const migrations = readdirSync("prisma/migrations").map((entry) => entry.toLowerCase());
    assert.equal(
      migrations.some((entry) => entry.includes("neon") || entry.includes("better")),
      false,
      `no POC migration may exist (found ${migrations.join(", ")})`
    );
  });
});
