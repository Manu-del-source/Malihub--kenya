import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveChatWebSocketBase } from "@/lib/chat/ws-config";

describe("chat WebSocket destination", () => {
  it("accepts the configured secure origin, rejecting credentials and query fragments", () => {
    assert.equal(resolveChatWebSocketBase("wss://api.example.test/path", "production")?.origin, "wss://api.example.test");
    for (const value of ["https://api.example.test", "wss://user:pass@api.example.test", "wss://api.example.test?next=elsewhere", "wss://api.example.test/#fragment"]) {
      assert.equal(resolveChatWebSocketBase(value, "production"), null);
    }
  });

  it("allows plaintext sockets only on local development hosts", () => {
    assert.ok(resolveChatWebSocketBase("ws://localhost:8000", "development"));
    assert.equal(resolveChatWebSocketBase("ws://localhost:8000", "production"), null);
    assert.equal(resolveChatWebSocketBase("ws://other.example.test", "development"), null);
  });

  it("adds only the configured WebSocket origin to CSP", async () => {
    process.env.NEXT_PUBLIC_CHAT_WS_BASE_URL = "wss://api.example.test/";
    const config = (await import("../../../../next.config")).default;
    const headers = await config.headers!();
    const csp = headers[0]!.headers.find((header) => header.key === "Content-Security-Policy")!.value;
    const connect = csp.split("; ").find((directive) => directive.startsWith("connect-src"))!;
    assert.match(connect, /wss:\/\/api\.example\.test/);
    assert.doesNotMatch(connect, /wss:\/\/unrelated\.example/);
  });
});
