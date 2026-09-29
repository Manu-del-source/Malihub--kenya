import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import {
  AUTH_ROUTE_PREFIXES,
  BUYER_DASHBOARD_PATH,
  PROTECTED_PREFIXES,
  SELLER_DASHBOARD_PATH,
  isAuthRoutePath,
  isProtectedPath,
} from "@/lib/auth/config";

/**
 * Canonical routing invariants for the shared buyer/seller marketplace.
 *
 * Two things are pinned here:
 *
 *  1. **No stale `/dashboard/...` URLs.** `(dashboard)` is a Next.js route
 *     GROUP — its parentheses never appear in a URL — and an earlier revision
 *     of this repo shipped redirects to a `/dashboard/...` form of these
 *     routes, which 404'd after sign-in. This test scans the whole `src/`
 *     tree so that mistake cannot silently come back through a copy-pasted
 *     link, doc comment or action.
 *
 *  2. **The canonical routes stay canonical and correctly classified**:
 *     `/buyer`, `/seller`, `/account`, `/messages`… are protected;
 *     `/marketplace` (browsing), `/search`, `/products/[slug]` and the
 *     `/complete-profile` repair flow keep their intended visibility.
 */

const SRC_ROOT = path.join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

// Assembled from fragments so THIS file doesn't contain the literals it
// scans for — otherwise the test would flag itself as the only offender.
const STALE_REFS = [
  "/dashboard" + "/buyer",
  "/dashboard" + "/seller",
] as const;

describe("canonical routes — no stale route-group URLs anywhere in src/", () => {
  it("never references the route group as a URL segment", () => {
    const offenders: string[] = [];

    for (const file of walk(SRC_ROOT)) {
      const content = readFileSync(file, "utf-8");
      for (const stale of STALE_REFS) {
        if (content.includes(stale)) {
          offenders.push(`${path.relative(process.cwd(), file)} → ${stale}`);
        }
      }
    }

    assert.deepEqual(
      offenders,
      [],
      `stale route references found (the (dashboard) group never appears in URLs):\n${offenders.join("\n")}`
    );
  });

  it("route constants point at the real URLs", () => {
    assert.equal(BUYER_DASHBOARD_PATH, "/buyer");
    assert.equal(SELLER_DASHBOARD_PATH, "/seller");
    for (const prefix of PROTECTED_PREFIXES) {
      assert.ok(
        !prefix.startsWith("/dashboard"),
        `${prefix} is not a real URL — (dashboard) is a route group`
      );
    }
  });
});

describe("canonical routes — visibility classification", () => {
  it("protects the buyer surfaces", () => {
    for (const path of [
      "/buyer",
      "/buyer/cart",
      "/buyer/wishlist",
      "/buyer/orders",
      "/buyer/orders/ord-1",
    ]) {
      assert.ok(isProtectedPath(path), `${path} should require a session`);
    }
  });

  it("protects the seller surfaces", () => {
    for (const path of [
      "/seller",
      "/seller/products",
      "/seller/products/new",
      "/seller/products/prod-1",
      "/seller/orders",
      "/seller/sales",
      "/seller/listings",
    ]) {
      assert.ok(isProtectedPath(path), `${path} should require a session`);
    }
  });

  it("protects the shared account area", () => {
    assert.ok(isProtectedPath("/account"));
    assert.ok(isProtectedPath("/messages"));
    assert.ok(isProtectedPath("/notifications"));
  });

  it("keeps the marketplace and product catalogue public", () => {
    for (const path of [
      "/marketplace",
      "/marketplace/6b1f3a5e-1111-4222-8333-444455556666",
      "/search",
      "/products/iphone-13",
      "/categories/electronics",
      "/sellers/yegon",
    ]) {
      assert.ok(!isProtectedPath(path), `${path} should stay public`);
    }
  });

  it("keeps onboarding reachable while signed out", () => {
    for (const path of AUTH_ROUTE_PREFIXES) {
      assert.ok(isAuthRoutePath(path), `${path} should be an auth route`);
    }
    assert.ok(isAuthRoutePath("/complete-profile"));
    assert.ok(!isAuthRoutePath("/account"));
  });

  it("does not protect lookalike prefixes", () => {
    assert.ok(!isProtectedPath("/buyers"));
    assert.ok(!isProtectedPath("/sellers/organic-farm"));
    assert.ok(!isProtectedPath("/seller-portal"));
  });
});
