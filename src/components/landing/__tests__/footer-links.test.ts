import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { FOOTER_GROUPS } from "../footer-links";

/** All routes that have a page.tsx, with (route-groups) removed. */
function collectRoutes(dir: string, prefix = ""): string[] {
  const routes: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      const segment = /^\(.*\)$/.test(name) ? "" : `/${name}`;
      routes.push(...collectRoutes(full, prefix + segment));
    } else if (name === "page.tsx") {
      routes.push(prefix || "/");
    }
  }
  return routes;
}

describe("footer links", () => {
  const routes = new Set(collectRoutes(join(process.cwd(), "src/app")));

  it("every internal link points at a page that exists", () => {
    for (const group of FOOTER_GROUPS) {
      for (const link of group.links) {
        if (/^(mailto:|https?:)/.test(link.href)) continue;
        const path = link.href.split("#")[0] || "/";
        assert.ok(routes.has(path), `${group.heading} → ${link.label} (${link.href}) has no page`);
      }
    }
  });

  it("has no duplicate hrefs and gives sellers a path to start selling", () => {
    const hrefs = FOOTER_GROUPS.flatMap((g) => g.links.map((l) => l.href));
    assert.equal(new Set(hrefs).size, hrefs.length);
    assert.ok(FOOTER_GROUPS.some((g) => g.heading === "Sell" && g.links.some((l) => l.href === "/seller-center")));
  });

  it("Sell group is exactly Start selling and Become a supplier", () => {
    const sell = FOOTER_GROUPS.find((g) => g.heading === "Sell");
    assert.deepEqual(sell?.links.map((l) => l.href), ["/seller-center", "/become-a-supplier"]);
  });

  it("keeps the legal pages and cookie settings reachable", () => {
    const legal = FOOTER_GROUPS.find((g) => g.heading === "Legal");
    assert.deepEqual(legal?.links.map((l) => l.href), ["/terms", "/privacy"]);
    assert.equal(legal?.includeCookieSettings, true);
  });
});
