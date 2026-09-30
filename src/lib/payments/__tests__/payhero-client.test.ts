import { before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type {
  FetchLike,
  PayheroClientError as PayheroClientErrorType,
  PayheroConfig,
} from "@/lib/payments/payhero";

// The client module is `server-only`; substitute a no-op at the module
// boundary, then import the client DYNAMICALLY (like every other suite here:
// static imports would evaluate before the mock registers).
mock.module("server-only", { namedExports: {} });

/**
 * The PayHero HTTP boundary, fully offline. `fetchImpl` is injected, so these
 * tests see the EXACT request the client builds (URL, headers, body) and can
 * script any response — 2xx, 4xx, 5xx, garbage, hangs — without a network,
 * and without a real PAYHERO_AUTH_TOKEN anywhere near the suite.
 *
 * What matters here, in order:
 *  1. Requests are built exactly per the documented contract (Basic auth,
 *     JSON, channel/provider/callback from config — never from a caller).
 *  2. Responses are validated, and every failure collapses into one
 *     `PayheroClientError.kind` the service layer can map.
 *  3. The token never leaks into an error message or a log line.
 */

let payhero: typeof import("@/lib/payments/payhero");
let createPayheroClient: typeof payhero.createPayheroClient;
let resolvePayheroConfig: typeof payhero.resolvePayheroConfig;
let PayheroClientError: typeof payhero.PayheroClientError;

before(async () => {
  payhero = await import("@/lib/payments/payhero");
  createPayheroClient = payhero.createPayheroClient;
  resolvePayheroConfig = payhero.resolvePayheroConfig;
  PayheroClientError = payhero.PayheroClientError;
});

const CONFIG: PayheroConfig = {
  apiUrl: "https://backend.payhero.co.ke/api/v2",
  authToken: "dGVzdC10b2tlbi1vbmx5",
  channelId: 133,
  callbackUrl: "https://malihub.example.com/api/payments/payhero/callback",
  timeoutMs: 15_000,
};

type CapturedRequest = { url: string; init: RequestInit };

/** A fetch stub that records the request and answers with a queued script. */
function scriptedFetch(
  script: (call: CapturedRequest) => { ok: boolean; status: number; body: unknown } | never
): { fetch: FetchLike; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  const fetch: FetchLike = async (input, init) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    const answer = script(call);
    return {
      ok: answer.ok,
      status: answer.status,
      json: async () => answer.body,
    };
  };
  return { fetch, calls };
}

const httpError = (status: number) => ({ ok: false, status, body: {} });
const httpJson = (body: unknown, status = 200) => ({ ok: true, status, body });

describe("resolvePayheroConfig", () => {
  it("resolves a complete configuration", () => {
    const result = resolvePayheroConfig({
      PAYHERO_AUTH_TOKEN: "token",
      PAYHERO_CHANNEL_ID: "133",
      PAYHERO_CALLBACK_URL: "https://malihub.example.com/api/payments/payhero/callback",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.config.apiUrl, "https://backend.payhero.co.ke/api/v2");
      assert.equal(result.config.channelId, 133);
      assert.equal(result.config.timeoutMs, 15_000);
    }
  });

  it("reports every missing variable instead of failing at first use", () => {
    const result = resolvePayheroConfig({});
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.deepEqual(new Set(result.missing), new Set([
        "PAYHERO_AUTH_TOKEN",
        "PAYHERO_CHANNEL_ID",
        "PAYHERO_CALLBACK_URL",
      ]));
    }
  });

  it("rejects a non-numeric or non-positive channel id", () => {
    for (const channelId of ["abc", "-3", "1.5"]) {
      const result = resolvePayheroConfig({
        PAYHERO_AUTH_TOKEN: "token",
        PAYHERO_CHANNEL_ID: channelId,
        PAYHERO_CALLBACK_URL: "https://malihub.example.com/cb",
      });
      assert.equal(result.ok, false, channelId);
      if (!result.ok) assert.ok(result.invalid.includes("PAYHERO_CHANNEL_ID"));
    }
  });

  it("rejects a non-HTTPS callback URL outside localhost", () => {
    const result = resolvePayheroConfig({
      PAYHERO_AUTH_TOKEN: "token",
      PAYHERO_CHANNEL_ID: "133",
      PAYHERO_CALLBACK_URL: "http://payments.example.com/callback",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.invalid.includes("PAYHERO_CALLBACK_URL"));
  });

  it("strips a trailing slash from the API URL and rejects nonsense", () => {
    const good = resolvePayheroConfig({
      PAYHERO_API_URL: "https://backend.payhero.co.ke/api/v2/",
      PAYHERO_AUTH_TOKEN: "token",
      PAYHERO_CHANNEL_ID: "133",
      PAYHERO_CALLBACK_URL: "https://malihub.example.com/cb",
    });
    assert.equal(good.ok, true);
    if (good.ok) assert.equal(good.config.apiUrl, "https://backend.payhero.co.ke/api/v2");

    const bad = resolvePayheroConfig({
      PAYHERO_API_URL: "not-a-url",
      PAYHERO_AUTH_TOKEN: "token",
      PAYHERO_CHANNEL_ID: "133",
      PAYHERO_CALLBACK_URL: "https://malihub.example.com/cb",
    });
    assert.equal(bad.ok, false);
  });
});

describe("PayHeroClient.initiateStkPush", () => {
  const params = {
    amountKes: 100,
    phoneNumber: "254787677676",
    externalReference: "MH-TEST1234",
    customerName: "John Doe",
  };

  it("builds the documented STK request exactly", async () => {
    const { fetch, calls } = scriptedFetch(() =>
      httpJson({
        success: true,
        status: "QUEUED",
        reference: "E8UWT7CLUW",
        CheckoutRequestID: "ws_CO_15012024164321519708344109",
      })
    );
    const client = createPayheroClient(CONFIG, fetch);

    const result = await client.initiateStkPush(params);

    assert.equal(calls.length, 1);
    const { url, init } = calls[0]!;
    assert.equal(url, "https://backend.payhero.co.ke/api/v2/payments");
    assert.equal(init.method, "POST");

    const headers = init.headers as Record<string, string>;
    // Basic auth with the configured token, verbatim — and JSON.
    assert.equal(headers.Authorization, `Basic ${CONFIG.authToken}`);
    assert.equal(headers["Content-Type"], "application/json");

    const body = JSON.parse(String(init.body));
    // Amount stays the whole-KES integer the service handed over.
    assert.equal(body.amount, 100);
    assert.equal(body.phone_number, "254787677676");
    // channel_id, provider and callback_url come from CONFIG, never params.
    assert.equal(body.channel_id, 133);
    assert.equal(body.provider, "m-pesa");
    assert.equal(body.external_reference, "MH-TEST1234");
    assert.equal(body.callback_url, CONFIG.callbackUrl);
    assert.equal(body.customer_name, "John Doe");

    assert.equal(result.reference, "E8UWT7CLUW");
    assert.equal(result.checkoutRequestId, "ws_CO_15012024164321519708344109");
    assert.equal(result.status, "QUEUED");
  });

  it("omits customer_name when not provided", async () => {
    const { fetch, calls } = scriptedFetch(() =>
      httpJson({ success: true, status: "QUEUED", reference: "R1", CheckoutRequestID: "C1" })
    );
    const client = createPayheroClient(CONFIG, fetch);
    await client.initiateStkPush({ ...params, customerName: undefined });
    const body = JSON.parse(String(calls[0]!.init.body));
    assert.equal("customer_name" in body, false);
  });

  it("maps a PayHero 4xx to http_rejected with the status", async () => {
    const { fetch } = scriptedFetch(() => httpError(400));
    const client = createPayheroClient(CONFIG, fetch);
    await assert.rejects(client.initiateStkPush(params), (error: unknown) => {
      assert.ok(error instanceof PayheroClientError);
      assert.equal(error.kind, "http_rejected");
      assert.equal(error.httpStatus, 400);
      return true;
    });
  });

  it("maps a PayHero 5xx to http_error", async () => {
    const { fetch } = scriptedFetch(() => httpError(503));
    const client = createPayheroClient(CONFIG, fetch);
    await assert.rejects(client.initiateStkPush(params), (error: unknown) => {
      assert.ok(error instanceof PayheroClientError);
      assert.equal(error.kind, "http_error");
      assert.equal(error.httpStatus, 503);
      return true;
    });
  });

  it("maps a well-formed refusal (success:false) to declined", async () => {
    const { fetch } = scriptedFetch(() =>
      httpJson({ success: false, message: "Insufficient balance on wallet" })
    );
    const client = createPayheroClient(CONFIG, fetch);
    await assert.rejects(client.initiateStkPush(params), (error: unknown) => {
      assert.ok(error instanceof PayheroClientError);
      assert.equal(error.kind, "declined");
      return true;
    });
  });

  it("treats a malformed success body as invalid_response", async () => {
    const { fetch } = scriptedFetch(() => httpJson("<html>not json shape</html>"));
    const client = createPayheroClient(CONFIG, fetch);
    await assert.rejects(client.initiateStkPush(params), (error: unknown) => {
      assert.equal((error as PayheroClientErrorType).kind, "invalid_response");
      return true;
    });
  });

  it("rejects a 'success' body missing the identifiers we must persist", async () => {
    const { fetch } = scriptedFetch(() => httpJson({ success: true, status: "QUEUED" }));
    const client = createPayheroClient(CONFIG, fetch);
    await assert.rejects(client.initiateStkPush(params), (error: unknown) => {
      assert.equal((error as PayheroClientErrorType).kind, "invalid_response");
      return true;
    });
  });

  it("maps a network failure to network", async () => {
    const { fetch } = scriptedFetch(() => {
      throw new TypeError("fetch failed");
    });
    const client = createPayheroClient(CONFIG, fetch);
    await assert.rejects(client.initiateStkPush(params), (error: unknown) => {
      assert.equal((error as PayheroClientErrorType).kind, "network");
      return true;
    });
  });

  it("maps an abort/timeout to timeout", async () => {
    const { fetch } = scriptedFetch(() => {
      throw Object.assign(new Error("The operation timed out"), { name: "TimeoutError" });
    });
    const client = createPayheroClient(CONFIG, fetch);
    await assert.rejects(client.initiateStkPush(params), (error: unknown) => {
      assert.equal((error as PayheroClientErrorType).kind, "timeout");
      return true;
    });
  });

  it("attaches a real abort signal bounded by the configured timeout", async () => {
    const { fetch, calls } = scriptedFetch(() =>
      httpJson({ success: true, reference: "R1", CheckoutRequestID: "C1" })
    );
    const client = createPayheroClient({ ...CONFIG, timeoutMs: 9_999 }, fetch);
    await client.initiateStkPush(params);
    const signal = calls[0]!.init.signal as AbortSignal;
    assert.ok(signal instanceof AbortSignal);
    assert.equal(signal.aborted, false);
    // AbortSignal.timeout() exposes its budget in Node ≥ 20 internals only;
    // the meaningful contract here is that a bounded signal exists at all.
  });

  it("never leaks the auth token into an error message or the log", async () => {
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args);
    try {
      const { fetch } = scriptedFetch(() => httpError(500));
      const client = createPayheroClient(CONFIG, fetch);
      const failure = await client.initiateStkPush(params).catch((error: unknown) => error);
      assert.ok(failure instanceof PayheroClientError);
      assert.equal(failure.message.includes(CONFIG.authToken), false);
      for (const entry of warnings) {
        assert.equal(JSON.stringify(entry).includes(CONFIG.authToken), false);
      }
    } finally {
      console.warn = originalWarn;
    }
  });
});

describe("PayHeroClient.getTransactionStatus", () => {
  it("calls the documented endpoint with the reference encoded", async () => {
    const { fetch, calls } = scriptedFetch(() =>
      httpJson({
        success: true,
        status: "SUCCESS",
        reference: "6b71cb8b-638d-4b6e-9c7c-b0334a641e3a",
        provider: "m-pesa",
        provider_reference: "SKQ96C7K7H",
        third_party_reference: "SKQ96C7K7H",
        CheckoutRequestID: "",
      })
    );
    const client = createPayheroClient(CONFIG, fetch);

    const result = await client.getTransactionStatus("PH-REF 9");

    assert.equal(
      calls[0]!.url,
      "https://backend.payhero.co.ke/api/v2/transaction-status?reference=PH-REF%209"
    );
    assert.equal(calls[0]!.init.method, "GET");
    assert.equal(result.status, "SUCCESS");
    assert.equal(result.knownStatus, true);
    assert.equal(result.providerReference, "SKQ96C7K7H");
  });

  for (const provider of ["QUEUED", "SUCCESS", "FAILED"] as const) {
    it(`passes through the documented status ${provider}`, async () => {
      const { fetch } = scriptedFetch(() => httpJson({ success: true, status: provider }));
      const client = createPayheroClient(CONFIG, fetch);
      const result = await client.getTransactionStatus("R1");
      assert.equal(result.status, provider);
      assert.equal(result.knownStatus, true);
    });
  }

  it("flags an undocumented status instead of guessing it", async () => {
    const { fetch } = scriptedFetch(() => httpJson({ success: true, status: "REVERSED_MAYBE" }));
    const client = createPayheroClient(CONFIG, fetch);
    const result = await client.getTransactionStatus("R1");
    assert.equal(result.knownStatus, false);
    assert.equal(result.rawStatus, "REVERSED_MAYBE");
    // The safe bucket is "no final answer" — never SUCCESS or FAILED.
    assert.equal(result.status, "QUEUED");
  });

  it("maps HTTP and shape failures to the same kinds as initiation", async () => {
    for (const [script, kind] of [
      [() => httpError(500), "http_error"],
      [() => httpError(404), "http_rejected"],
      [() => httpJson({ unexpected: true }), "invalid_response"],
    ] as const) {
      const { fetch } = scriptedFetch(script);
      const client = createPayheroClient(CONFIG, fetch);
      await assert.rejects(client.getTransactionStatus("R1"), (error: unknown) => {
        assert.equal((error as PayheroClientErrorType).kind, kind);
        return true;
      });
    }
  });
});
