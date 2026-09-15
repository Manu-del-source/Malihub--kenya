import "server-only";
import { Redis } from "@upstash/redis";

let client: Redis | null | undefined;

/**
 * Returns the shared Redis client, or null if Upstash isn't configured.
 * `undefined` (not yet checked) vs `null` (checked, unavailable) lets us
 * only warn once instead of on every call.
 */
export function getRedis(): Redis | null {
  if (client !== undefined) return client;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    console.warn(
      "[redis] UPSTASH_REDIS_REST_URL/TOKEN not set — rate limiting and caching are disabled. " +
        "Fine for local dev; required in production (see README's Redis setup section)."
    );
    client = null;
    return client;
  }

  client = new Redis({ url, token });
  return client;
}
