import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

/**
 * Production database migrations are a separately approved operation.
 * A normal Vercel Production build must never mutate the database merely
 * because a PR was merged. Explicit opt-in is required for an exceptional,
 * reviewed deployment window.
 */
if (process.env.VERCEL !== "1" || process.env.VERCEL_ENV !== "production") {
  console.log("[migrations] Skipping automatic migration outside Vercel Production.");
  process.exit(0);
}

if (process.env.MALIHUB_ALLOW_AUTOMATIC_PRODUCTION_MIGRATIONS !== "true") {
  console.log(
    "[migrations] Skipping production migrations: explicit opt-in is not enabled. " +
      "Apply reviewed migrations as a separate maintenance operation."
  );
  process.exit(0);
}

// Never run production migrations over the pooled DATABASE_URL fallback.
// A deliberate migration operation must provide a direct/unpooled connection.
if (!process.env.DIRECT_URL?.trim()) {
  console.error(
    "[migrations] DIRECT_URL is required for an explicitly approved production migration. " +
      "Refusing to fall back to DATABASE_URL."
  );
  process.exit(1);
}

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const maxAttempts = 4;

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  console.log(`[migrations] Applying explicitly approved Prisma migrations (attempt ${attempt}/${maxAttempts})…`);

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
