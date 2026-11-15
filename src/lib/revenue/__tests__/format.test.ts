import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatKsh } from "../format";

describe("formatKsh", () => {
  it("formats whole and fractional shillings with the KSh prefix", () => {
    assert.equal(formatKsh(300_000), "KSh 3,000");
    assert.equal(formatKsh(300_050), "KSh 3,000.50");
    assert.equal(formatKsh(5), "KSh 0.05");
    assert.equal(formatKsh(0), "KSh 0");
    assert.equal(formatKsh(-10_000), "-KSh 100");
  });
});
