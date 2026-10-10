import { spawnSync } from "node:child_process";

/**
 * Apply additive Prisma migrations only in the Vercel Production build.
 * Preview builds must not mutate a production database if environments were
 * accidentally pointed at the same connection string.
 *
 * Keep this before next build: routes that query the database during build
 * must see the same additive schema that the new application code expects.
 */
if (process.env.VERCEL !== "1" || process.env.VERCEL_ENV !== "production") {
  console.log("[migrations] Skipping automatic migration outside Vercel Production.");
  process.exit(0);
}

console.log("[migrations] Applying pending Prisma migrations for Vercel Production…");
const command = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(command, ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error("[migrations] Could not start Prisma migrate deploy:", result.error.message);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
