import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { safeInternalRedirect } from "@/lib/redirect-safety";

/**
 * Open-redirect protection — every vector from the audit must be rejected,
 * and every legitimate internal route must be accepted.
 */

describe("safeInternalRedirect — rejects hostile targets", () => {
  const hostile = [
    "https://evil.example",
    "http://evil.example",
    "//evil.example/steal",
    "\\\\evil.example/steal",
    "/\\evil.example/steal",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "mailto:evil@example.com",
    "https:evil.example",
    "////evil.example",
    "///evil.example",
    "/%00",
    "/\u0000evil",
    "/evil\u000b",
    "/evil\n",
    "/evil\t",
    "https://malihub.smartbiz365.site.evil.example",
    "/dashboard?next=https://evil.example", // fine as path, but see note below
  ];

  for (const value of hostile) {
    it(`rejects ${JSON.stringify(value)}`, () => {
      // The last entry is actually a legitimate same-origin PATH (the query
      // value is inert — the browser never interprets query strings as URLs),
      // so treat it separately below.
      if (value === "/dashboard?next=https://evil.example") return;
      assert.equal(safeInternalRedirect(value), null, `should reject ${JSON.stringify(value)}`);
    });
  }

  it("accepts /dashboard?next=… as a same-origin path (query values are inert)", () => {
    assert.equal(safeInternalRedirect("/dashboard?next=https://evil.example"), "/dashboard?next=https://evil.example");
  });

  it("rejects overlong targets", () => {
    assert.equal(safeInternalRedirect(`/${"a".repeat(3000)}`), null);
  });

  it("rejects non-string / empty / undefined", () => {
    assert.equal(safeInternalRedirect(""), null);
    assert.equal(safeInternalRedirect(null), null);
    assert.equal(safeInternalRedirect(undefined), null);
    // @ts-expect-error — deliberate malformed input
    assert.equal(safeInternalRedirect(42), null);
    // @ts-expect-error — deliberate malformed input
    assert.equal(safeInternalRedirect({}), null);
  });
});

describe("safeInternalRedirect — accepts legitimate internal routes", () => {
  const cases: Array<[string, string]> = [
    ["/", "/"],
    ["/complete-profile", "/complete-profile"],
    ["/login", "/login"],
    ["/dashboard/buyer", "/dashboard/buyer"],
    ["/dashboard/seller/listings", "/dashboard/seller/listings"],
    ["/dashboard/admin/users", "/dashboard/admin/users"],
    ["/dashboard/buyer/orders?status=open", "/dashboard/buyer/orders?status=open"],
    ["/search?q=shoes&county=Nairobi", "/search?q=shoes&county=Nairobi"],
    ["/products/slug-1#description", "/products/slug-1#description"],
    ["/messages/abc-123?unread=1#thread", "/messages/abc-123?unread=1#thread"],
  ];

  for (const [input, expected] of cases) {
    it(`accepts ${JSON.stringify(input)}`, () => {
      assert.equal(safeInternalRedirect(input), expected);
    });
  }

  it("normalizes duplicate slashes in the path but keeps them same-origin", () => {
    // "/a//b" is a path on our origin; the URL parser preserves it.
    const result = safeInternalRedirect("/a//b");
    assert.ok(result !== null && result.startsWith("/a"), `got ${result}`);
  });
});
