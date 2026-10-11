import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

/**
 * Apply additive Prisma migrations only in the Vercel Production build.
 * Preview builds must not mutate a production database if environments were
 * accidentally pointed at the same connection string.
 *
 * Prefer DIRECT_URL (a direct, unpooled Postgres connection). Older Vercel
 * configurations may not have populated it; in that case use DATABASE_URL.
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

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const maxAttempts = 4;

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  console.log(`[migrations] Applying pending Prisma migrations (attempt ${attempt}/${maxAttempts})…`);

  const result = spawnSync(command, ["prisma", "migrate", "deploy"], {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.error) {
    console.error("[migrations] Could not start Prisma migrate deploy:", result.error.message);
    process.exit(1);
  }

  if (result.status === 0) {
    process.exit(0);
  }

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const isTransientLockOrConnectionTimeout =
    /P1002|timed out trying to acquire a postgres advisory lock|server.*timed out|connection.*timed out/i.test(output);

  if (!isTransientLockOrConnectionTimeout || attempt === maxAttempts) {
    console.error(`[migrations] Prisma migrate deploy failed with exit code ${result.status ?? "unknown"}.`);
    process.exit(result.status ?? 1);
  }

  const waitMs = attempt * 5000;
  console.warn(`[migrations] Database lock/connection timeout; retrying in ${waitMs / 1000}s.`);
  await delay(waitMs);
}

process.exit(1);
