#!/usr/bin/env node
/**
 * Migrate profile avatars from Supabase Storage to Cloudinary.
 *
 * Part of the Supabase removal (docs/SUPABASE-REMOVAL-PLAN.md, Phase 2).
 * Every `Profile.avatarUrl` that points at OUR Supabase project's `avatars`
 * bucket is re-uploaded to Cloudinary (authenticated API, same account as
 * listing images) and the profile row is updated through Prisma.
 *
 * Safety model:
 *  - READ-ONLY on Supabase: files are downloaded from the public-read URL;
 *    this script NEVER deletes Supabase objects. Cleaning the bucket up is a
 *    separate, manual step after the migration is verified in production.
 *  - IDEMPOTENT + REPEATABLE: the Cloudinary public id is derived
 *    deterministically from the old URL (`avatars/<owner>/migrated-<hash>`),
 *    so a rerun overwrites the same asset instead of creating duplicates;
 *    rows already pointing at Cloudinary are skipped; an old→new mapping is
 *    written to `data/avatar-url-map.json` (gitignored) for audit and
 *    recovery, and rows are skipped when the mapping already covers them.
 *  - FAIL-CLOSED on configuration: a missing Supabase URL, Cloudinary
 *    credentials, or DATABASE_URL aborts before any work starts.
 *  - PER-ROW ERROR ISOLATION: one unreadable file never aborts the batch;
 *    failures are reported and the exit code equals the failure count
 *    (capped at 1) so a CI wrapper can gate on it.
 *
 * Usage:
 *   node scripts/migrate-avatars-to-cloudinary.mjs --dry-run     # report only
 *   node scripts/migrate-avatars-to-cloudinary.mjs               # run
 *   node scripts/migrate-avatars-to-cloudinary.mjs --limit 20    # stop after 20
 *
 * Requires a generated Prisma client (`npx prisma generate`) and env:
 * DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
 * CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ─── Pure helpers (exported for unit tests — no I/O, no deps) ───────────────

/** True if `url` is a public file URL of the Supabase project at `supabaseUrl`. */
export function isSupabaseProjectFileUrl(url, supabaseUrl) {
  if (!url || !supabaseUrl) return false;
  try {
    const parsed = new URL(url);
    const expected = new URL(supabaseUrl);
    return (
      parsed.hostname === expected.hostname &&
      parsed.pathname.startsWith("/storage/v1/object/public/")
    );
  } catch {
    return false;
  }
}

/**
 * Deterministic Cloudinary public id for a legacy avatar URL:
 * `avatars/<owner>/migrated-<12 hex>`.
 *
 * `<owner>` is the first path segment after `avatars/` in the legacy URL
 * (an application user id, or — for rows written before the application row
 * existed — the auth identity id). Safe-segment validation (alphanumerics,
 * dashes, underscores) keeps a malformed URL from escaping the `avatars/`
 * folder scope the same way the upload route guards it.
 *
 * Returns `null` when the URL is not a legacy avatars-bucket URL.
 */
export function deriveLegacyAvatarPublicId(oldUrl) {
  try {
    const segments = new URL(oldUrl).pathname.split("/").filter(Boolean);
    const idx = segments.indexOf("avatars");
    if (idx === -1) return null;
    const owner = segments[idx + 1] ?? "";
    const file = segments[idx + 2] ?? "";
    // A legacy avatar is `avatars/<owner>/<file>` — missing the file segment
    // means the URL is malformed, and a path-separator in either segment
    // would escape the avatars folder scope.
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(owner) || !/^[A-Za-z0-9._-]{1,255}$/.test(file)) return null;
    const hash = createHash("sha256").update(oldUrl).digest("hex").slice(0, 12);
    return `avatars/${owner}/migrated-${hash}`;
  } catch {
    return null;
  }
}

/**
 * True if `url` is already a Cloudinary-hosted avatar (the shape the app
 * produces: `res.cloudinary.com/<cloud>/image/upload/avatars/…`). Such rows
 * need no migration — this is also what makes reruns no-ops.
 */
export function isCloudinaryAvatarUrl(url, cloudName) {
  if (!url || !cloudName) return false;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "res.cloudinary.com") return false;
    const segments = parsed.pathname.split("/").filter(Boolean);
    return (
      segments[0] === cloudName &&
      segments[1] === "image" &&
      segments[2] === "upload" &&
      segments[3] === "avatars"
    );
  } catch {
    return false;
  }
}

/** Loads the old→new mapping file, or `{}` when absent/corrupt. */
export function loadMapping(file) {
  if (!file || !existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Writes the mapping file (creating parent directories). */
export function saveMapping(file, mapping) {
  if (!file) return;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(mapping, null, 2)}\n`, "utf8");
}

// ─── Buffer validation (duplicated from src/lib/validations/image-file.ts —
// this script is plain Node and must not import the TypeScript source tree).

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

function startsWith(bytes, signature) {
  if (bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

export function classifyImageMagic(bytes) {
  if (startsWith(bytes, JPEG)) return "jpeg";
  if (startsWith(bytes, PNG)) return "png";
  if (startsWith(bytes, RIFF) && bytes.length >= 12) {
    const tag = Array.from(bytes.subarray(8, 12));
    if (tag.every((value, index) => value === WEBP[index])) return "webp";
  }
  return null;
}

// ─── The migration itself ────────────────────────────────────────────────────

const MAX_AVATAR_BYTES = 3 * 1024 * 1024; // matches the upload route + old bucket

function parseArgs(argv) {
  const args = { dryRun: false, limit: Infinity, mapping: path.join("data", "avatar-url-map.json") };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--mapping") args.mapping = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log("Usage: node scripts/migrate-avatars-to-cloudinary.mjs [--dry-run] [--limit N] [--mapping FILE]");
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  if (!Number.isFinite(args.limit) || args.limit < 1) {
    console.error("--limit must be a positive integer");
    process.exit(2);
  }
  return args;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`FATAL: ${name} is not set — refusing to run (fail closed).`);
    process.exit(2);
  }
  return value;
}

async function migrate(args) {
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const cloudName = requireEnv("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME");
  requireEnv("CLOUDINARY_API_KEY");
  requireEnv("CLOUDINARY_API_SECRET");
  requireEnv("DATABASE_URL");

  const { PrismaClient } = await import("@prisma/client");
  const { v2: cloudinary } = await import("cloudinary");

  cloudinary.config({
    cloud_name: cloudName,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });

  const prisma = new PrismaClient();
  const mappingFile = path.resolve(args.mapping);
  const mapping = loadMapping(mappingFile);

  try {
    const profiles = await prisma.profile.findMany({
      where: { avatarUrl: { not: null } },
      select: { userId: true, avatarUrl: true },
    });
    const candidates = profiles.filter(
      (p) =>
        isSupabaseProjectFileUrl(p.avatarUrl, supabaseUrl) &&
        !isCloudinaryAvatarUrl(p.avatarUrl, cloudName) &&
        !mapping[p.avatarUrl]
    );

    console.log(
      `Found ${candidates.length} legacy Supabase avatar(s) to migrate` +
        (args.dryRun ? " [DRY RUN — nothing will be written]" : "")
    );

    let migrated = 0;
    let failures = 0;

      for (const row of candidates.slice(
        0,
        Number.isFinite(args.limit) ? args.limit : undefined
      )) {
        const { userId, avatarUrl } = row;
        const publicId = deriveLegacyAvatarPublicId(avatarUrl);
        if (!publicId) {
          console.warn(`SKIP  ${avatarUrl} — not a recognized avatars-bucket path`);
          failures += 1;
          continue;
        }

        if (args.dryRun) {
          console.log(`WOULD ${avatarUrl} → ${publicId}`);
          migrated += 1;
          continue;
        }

        try {
          const response = await fetch(avatarUrl, { redirect: "follow" });
          if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.length > MAX_AVATAR_BYTES) throw new Error(`file exceeds ${MAX_AVATAR_BYTES} bytes`);
          const kind = classifyImageMagic(bytes);
          if (!kind) throw new Error("not a valid JPEG/PNG/WebP (magic bytes)");

          const buffer = Buffer.from(bytes);
          const dataUri = `data:image/${kind};base64,${buffer.toString("base64")}`;
          const uploaded = await cloudinary.uploader.upload(dataUri, {
            public_id: publicId,
            resource_type: "image",
            use_filename: false,
            overwrite: true, // deterministic id — reruns replace, never duplicate
          });

          await prisma.profile.updateMany({
            where: { userId, avatarUrl },
            data: { avatarUrl: uploaded.secure_url },
          });

          mapping[avatarUrl] = uploaded.secure_url;
          saveMapping(mappingFile, mapping);
          console.log(`OK    ${avatarUrl} → ${uploaded.secure_url}`);
          migrated += 1;
        } catch (error) {
          failures += 1;
          console.error(
            `FAIL  ${avatarUrl} — ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      if (Number.isFinite(args.limit) && candidates.length > args.limit) {
        console.log(
          `(limit reached — ${candidates.length - args.limit} more remain; rerun to continue)`
        );
      }

      if (!args.dryRun) {
        // Final mapping save (covers the case where every row was already
        // mapped and no per-row save fired).
        saveMapping(mappingFile, mapping);
      }

      console.log(
        `${args.dryRun ? "Dry run complete" : "Migration complete"}: ` +
          `${migrated} migrated, ${failures} failed.`
      );
      return failures > 0 ? 1 : 0;
    } finally {
      // Close even on error paths — an open pool can wedge a CI runner.
      await prisma.$disconnect().catch(() => {});
    }
  }

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1] ?? "").href;

if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  migrate(args)
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error("FATAL:", error instanceof Error ? error.message : error);
      process.exit(2);
    });
}
