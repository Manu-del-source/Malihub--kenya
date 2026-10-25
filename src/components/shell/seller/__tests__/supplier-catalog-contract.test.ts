import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function read(relative: string) {
  return readFileSync(path.resolve(ROOT, relative), "utf-8");
}

describe("supplier catalog UI — credentials & environment safety", () => {
  it("client components in seller shell never read process.env directly", () => {
    const files = [
      "src/components/shell/seller/supplier-catalog-view.tsx",
      "src/components/shell/seller/listing-row-actions.tsx",
      "src/components/shell/seller/listing-status-badge.tsx",
    ];

    for (const file of files) {
      const source = read(file);
      assert.equal(
        source.includes("process.env"),
        false,
        `${file} must not read process.env in the browser`
      );
    }
  });

  it("supplier catalog client component contains no secrets or provider API keys", () => {
    const forbidden = [
      "PAYSTACK_SECRET_KEY",
      "PAYHERO_AUTH_TOKEN",
      "NEON_AUTH_COOKIE_SECRET",
      "CLOUDINARY_API_SECRET",
      "RESEND_API_KEY",
      "DATABASE_URL",
      "DIRECT_URL",
    ];

    const source = read("src/components/shell/seller/supplier-catalog-view.tsx");
    for (const secret of forbidden) {
      assert.equal(
        source.includes(secret),
        false,
        `supplier catalog UI must never reference ${secret}`
      );
    }
  });
});

describe("supplier catalog UI — contract and safety invariants", () => {
  it("routes through standard authenticated seller APIs", () => {
    const source = read("src/components/shell/seller/supplier-catalog-view.tsx");
    assert.match(source, /\/api\/seller\/supplier-products/, "fetches catalog via seller supplier products API");
    assert.match(source, /\/import/, "imports products via POST import route");
  });

  it("imported products route to draft editor rather than publishing automatically", () => {
    const source = read("src/components/shell/seller/supplier-catalog-view.tsx");
    assert.match(source, /\/seller\/listings\//, "provides link to draft listing");
    assert.match(source, /Imported as Draft/i, "clearly explains draft status");
  });

  it("listing edit screen displays verification warning for supplier-sourced products", () => {
    const source = read("src/app/(dashboard)/seller/listings/[id]/edit/page.tsx");
    assert.match(source, /supplierProduct/, "queries supplierProduct relationship");
    assert.match(source, /Supplier-sourced draft listing/i, "displays warning banner for supplier-sourced listings");
  });
});
