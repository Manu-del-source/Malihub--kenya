import { spawnSync } from "node:child_process";

/**
 * Apply additive Prisma migrations only in the Vercel Production build.
 * Preview builds must not mutate a production database if environments were
 * accidentally pointed at the same connection string.
 *
 * Prefer DIRECT_URL (a direct, unpooled Postgres connection). Older Vercel
 * configurations may not have populated it; in that case use DATABASE_URL
 * as a compatibility fallback and let Prisma report connection limitations.
 */
if (process.env.VERCEL !== "1" || process.env.VERCEL_ENV !== "production") {
  console.log("[migrations] Skipping automatic migration outside Vercel Production.");
  process.exit(0);
}

if (!process.env.DIRECT_URL?.trim()) {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("[migrations] Both DIRECT_URL and DATABASE_URL are missing. Configure the Production database connection in Vercel.");
    process.exit(1);
  }
  console.warn("[migrations] DIRECT_URL is empty; falling back to DATABASE_URL for migration. Configure an unpooled DIRECT_URL in Vercel for reliable migrations.");
  process.env.DIRECT_URL = process.env.DATABASE_URL;
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
