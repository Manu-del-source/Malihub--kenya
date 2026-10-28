import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("production Vercel builds never execute Prisma migrations, even if an old opt-in flag remains set", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/deploy-production-migrations.mjs"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        VERCEL: "1",
        VERCEL_ENV: "production",
        MALIHUB_ALLOW_AUTOMATIC_PRODUCTION_MIGRATIONS: "true",
        DIRECT_URL: "postgresql://example.invalid/unused",
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Skipping production migrations during build/);
  assert.doesNotMatch(result.stdout, /Applying explicitly approved Prisma migrations/);
});
