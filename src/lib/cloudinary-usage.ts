import "server-only";

import { getRedis } from "@/lib/redis";

const USAGE_CACHE_KEY = "malihub:cloudinary:usage:v1";
const USAGE_CACHE_SECONDS = 60;
const UPLOAD_BLOCK_PERCENT = 85;
const UPLOAD_WARNING_PERCENT = 70;

export type CloudinaryUsageSnapshot = {
  fetchedAt: string;
  creditUsagePercent: number;
  blocked: boolean;
  warning: boolean;
  provider: Record<string, unknown>;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required Cloudinary configuration: ${name}`);
  return value;
}

/**
 * Reads Cloudinary's account usage through its authenticated Admin API.
 * Cached briefly in Upstash so a multi-image upload does not make one Admin
 * API request per file. Upload authorization fails closed if usage cannot be
 * verified, because the feature exists to protect the account allowance.
 */
export async function getCloudinaryUsage(options: { refresh?: boolean } = {}): Promise<CloudinaryUsageSnapshot> {
  const redis = getRedis();
  if (!redis) throw new Error("Upstash Redis is required for Cloudinary upload safeguards.");

  if (!options.refresh) {
    const cached = await redis.get<CloudinaryUsageSnapshot>(USAGE_CACHE_KEY);
    if (cached && typeof cached === "object" && "creditUsagePercent" in cached) return cached;
  }

  const cloudName = requiredEnv("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME");
  const apiKey = requiredEnv("CLOUDINARY_API_KEY");
  const apiSecret = requiredEnv("CLOUDINARY_API_SECRET");
  const credentials = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");
  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/usage`, {
    method: "GET",
    headers: { Authorization: `Basic ${credentials}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    throw new Error(`Cloudinary usage API returned HTTP ${response.status}`);
  }

  const provider = (await response.json()) as Record<string, unknown>;
  const credits = provider.credits as Record<string, unknown> | undefined;
  const usage = typeof credits?.usage === "number" ? credits.usage : null;
  const limit = typeof credits?.limit === "number" ? credits.limit : null;
  const reportedPercent = typeof credits?.used_percent === "number" ? credits.used_percent : null;
  const percent = reportedPercent ?? (usage !== null && limit !== null && limit > 0 ? (usage / limit) * 100 : null);

  if (percent === null || !Number.isFinite(percent) || percent < 0) {
    throw new Error("Cloudinary usage response did not include a valid credits usage percentage.");
  }

  const snapshot: CloudinaryUsageSnapshot = {
    fetchedAt: new Date().toISOString(),
    creditUsagePercent: Math.min(100, percent),
    blocked: percent >= UPLOAD_BLOCK_PERCENT,
    warning: percent >= UPLOAD_WARNING_PERCENT,
    provider,
  };

  await redis.set(USAGE_CACHE_KEY, snapshot, { ex: USAGE_CACHE_SECONDS });
  return snapshot;
}

export async function assertCloudinaryUploadsAllowed(): Promise<void> {
  if (process.env.CLOUDINARY_UPLOADS_PAUSED === "true") {
    throw new Error("Cloudinary uploads are paused by the MaliHub administrator.");
  }

  const usage = await getCloudinaryUsage();
  if (usage.blocked) {
    throw new Error("Cloudinary usage has reached the 85% safety threshold; new product image uploads are paused.");
  }
}
