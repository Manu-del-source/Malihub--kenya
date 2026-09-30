import "server-only";

import { z } from "zod";

/**
 * PayHero API client — the ONLY module that talks to PayHero.
 *
 * ─── Scope ─────────────────────────────────────────────────────────────────
 * PayHero's v2 HTTP surface as MaliHub's collection flow uses it:
 *
 *   POST {base}/payments                       — M-Pesa STK Push initiation
 *   GET  {base}/transaction-status?reference=… — status verification/recovery
 *
 * Nothing else in the repository may build a PayHero URL, header or payload.
 * The services layer (`src/services/payment-service.ts`,
 * `src/services/payment-callback-service.ts`) owns WHEN to call; this module
 * owns HOW, including auth, timeouts, response validation and error
 * normalization.
 *
 * ─── Authentication ────────────────────────────────────────────────────────
 * PayHero uses Basic auth: `Authorization: Basic <PAYHERO_AUTH_TOKEN>`. The
 * token arrives fully-formed from configuration — this client never builds it
 * from parts and NEVER logs it. The header is attached inside `request()` and
 * is not exposed on any return value or error.
 *
 * ─── Logging policy ────────────────────────────────────────────────────────
 * Structured, breadcrumb-only: event name + sanitized context (status codes,
 * booleans, error kinds). Never the token, never the Authorization header,
 * never a phone number, never a payload. Route handlers decide what reaches
 * the client; this client only decides what reaches the logs.
 *
 * ─── Amount units ──────────────────────────────────────────────────────────
 * PayHero's `amount` is a WHOLE-number KES value. MaliHub money is integer
 * cents. Conversion happens in the service layer (which enforces
 * `amountCents % 100 === 0` before ever calling here); this client accepts an
 * already-converted whole KES amount and never does currency math of its own.
 */

// ─── Configuration ───────────────────────────────────────────────────────────

export const PAYHERO_DEFAULT_API_URL = "https://backend.payhero.co.ke/api/v2";

/** PayHero fronts M-Pesa; it is the only rail this phase collects through. */
export const PAYHERO_STK_PROVIDER = "m-pesa" as const;

export const PAYHERO_DEFAULT_TIMEOUT_MS = 15_000;

export type PayheroConfig = {
  /** Base API URL, e.g. https://backend.payhero.co.ke/api/v2 (no trailing slash). */
  apiUrl: string;
  /** The Basic-auth token value, attached verbatim after `Basic `. Never logged. */
  authToken: string;
  /** MaliHub's registered PayHero payment channel id (integer on PayHero's side). */
  channelId: number;
  /**
   * Server-configured callback URL handed to PayHero at initiation. Never
   * accepted from a client: a caller-chosen callback is how payment
   * confirmations get redirected to whoever the caller picks.
   */
  callbackUrl: string;
  timeoutMs: number;
};

/**
 * The env surface this integration reads. `process.env` satisfies this shape
 * directly; tests pass an explicit literal.
 */
export type PayheroConfigSource = {
  PAYHERO_API_URL?: string | undefined;
  PAYHERO_AUTH_TOKEN?: string | undefined;
  PAYHERO_CHANNEL_ID?: string | undefined;
  PAYHERO_CALLBACK_URL?: string | undefined;
  PAYHERO_TIMEOUT_MS?: string | undefined;
  [key: string]: string | undefined;
};

export type PayheroConfigResult =
  | { ok: true; config: PayheroConfig }
  | { ok: false; missing: string[]; invalid: string[] };

/**
 * Resolves PayHero configuration from the environment. Pure and side-effect
 * free so tests can pass an explicit env; production callers pass `process.env`.
 *
 * Every problem is reported as data — the service layer turns an unconfigured
 * provider into its own "not configured" error rather than a thrown surprise
 * deep inside an HTTP call. Placeholder-resolution mirrors the rest of the
 * repo's env conventions: an unset/blank value is "missing", never a default.
 */
export function resolvePayheroConfig(env: PayheroConfigSource): PayheroConfigResult {
  const missing: string[] = [];
  const invalid: string[] = [];

  const apiUrlRaw = env.PAYHERO_API_URL?.trim() || PAYHERO_DEFAULT_API_URL;
  let apiUrl = PAYHERO_DEFAULT_API_URL;
  try {
    const parsed = new URL(apiUrlRaw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      invalid.push("PAYHERO_API_URL");
    } else {
      apiUrl = parsed.origin + parsed.pathname.replace(/\/+$/, "");
    }
  } catch {
    invalid.push("PAYHERO_API_URL");
  }

  const authToken = env.PAYHERO_AUTH_TOKEN?.trim() ?? "";
  if (!authToken) missing.push("PAYHERO_AUTH_TOKEN");

  const channelRaw = env.PAYHERO_CHANNEL_ID?.trim() ?? "";
  let channelId = Number.NaN;
  if (!channelRaw) {
    missing.push("PAYHERO_CHANNEL_ID");
  } else if (!/^\d+$/.test(channelRaw)) {
    invalid.push("PAYHERO_CHANNEL_ID");
  } else {
    channelId = Number.parseInt(channelRaw, 10);
    if (!Number.isSafeInteger(channelId) || channelId <= 0) {
      invalid.push("PAYHERO_CHANNEL_ID");
    }
  }

  const callbackUrl = env.PAYHERO_CALLBACK_URL?.trim() ?? "";
  if (!callbackUrl) {
    missing.push("PAYHERO_CALLBACK_URL");
  } else {
    try {
      const parsed = new URL(callbackUrl);
      // The callback endpoint receives payment confirmations. Plain HTTP is
      // only tolerated for local development (PayHero cannot reach it anyway).
      if (
        parsed.protocol !== "https:" &&
        !(parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname))
      ) {
        invalid.push("PAYHERO_CALLBACK_URL");
      }
    } catch {
      invalid.push("PAYHERO_CALLBACK_URL");
    }
  }

  const timeoutRaw = env.PAYHERO_TIMEOUT_MS?.trim();
  let timeoutMs = PAYHERO_DEFAULT_TIMEOUT_MS;
  if (timeoutRaw) {
    const parsed = Number.parseInt(timeoutRaw, 10);
    if (!Number.isSafeInteger(parsed) || parsed < 1_000 || parsed > 60_000) {
      invalid.push("PAYHERO_TIMEOUT_MS");
    } else {
      timeoutMs = parsed;
    }
  }

  if (missing.length > 0 || invalid.length > 0) {
    return { ok: false, missing, invalid };
  }
  return {
    ok: true,
    config: { apiUrl, authToken, channelId, callbackUrl, timeoutMs },
  };
}

// ─── Wire contracts (validate everything PayHero sends) ─────────────────────

/**
 * Successful STK initiation response, per the documented contract:
 *
 *   { "success": true, "status": "QUEUED", "reference": "E8UWT7CLUW",
 *     "CheckoutRequestID": "ws_CO_…" }
 *
 * `QUEUED` means the STK request was accepted — it is NOT a collected payment,
 * and nothing here or in the services layer treats it as one.
 */
export const payheroStkInitiationResponseSchema = z.object({
  success: z.boolean(),
  status: z.string().optional(),
  reference: z.string().min(1).optional().nullable(),
  CheckoutRequestID: z.string().min(1).optional().nullable(),
  message: z.string().optional().nullable(),
});

export type PayheroStkInitiationResponse = z.infer<typeof payheroStkInitiationResponseSchema>;

/**
 * The transaction-status response. The documented vocabulary for `status` is
 * QUEUED | SUCCESS | FAILED; anything else is preserved verbatim and treated
 * as unknown by the mapping layer (never guessed).
 */
export const payheroTransactionStatusResponseSchema = z.object({
  success: z.boolean(),
  status: z.string().min(1),
  reference: z.string().optional().nullable(),
  provider_reference: z.string().optional().nullable(),
  third_party_reference: z.string().optional().nullable(),
  CheckoutRequestID: z.string().optional().nullable(),
  provider: z.string().optional().nullable(),
});

export type PayheroTransactionStatusResponse = z.infer<
  typeof payheroTransactionStatusResponseSchema
>;

/** The documented status vocabulary of the transaction-status endpoint. */
export type PayheroTransactionStatus = "QUEUED" | "SUCCESS" | "FAILED";

export function isPayheroTransactionStatus(value: string): value is PayheroTransactionStatus {
  return value === "QUEUED" || value === "SUCCESS" || value === "FAILED";
}

// ─── Errors ──────────────────────────────────────────────────────────────────

/**
 * Why a PayHero call failed, normalized so route/service code never branches
 * on fetch internals:
 *
 *  - `http_rejected`    — PayHero answered with a non-2xx status (STK refused).
 *  - `http_error`       — a 5xx/other server-side answer worth retrying later.
 *  - `network`          — DNS/TLS/connection failure before any HTTP answer.
 *  - `timeout`          — no answer within the configured timeout.
 *  - `invalid_response` — a 2xx answer whose body is not the documented shape.
 *  - `declined`         — a 2xx answer with `success: false` (well-formed "no").
 */
export type PayheroClientErrorKind =
  | "http_rejected"
  | "http_error"
  | "network"
  | "timeout"
  | "invalid_response"
  | "declined";

export class PayheroClientError extends Error {
  readonly kind: PayheroClientErrorKind;
  /** HTTP status when one was received. Never contains a secret. */
  readonly httpStatus?: number;

  constructor(kind: PayheroClientErrorKind, message: string, httpStatus?: number) {
    super(message);
    this.name = "PayheroClientError";
    this.kind = kind;
    this.httpStatus = httpStatus;
  }
}

// ─── The client ──────────────────────────────────────────────────────────────

export type PayheroStkPushParams = {
  /** Whole-number KES (conversion from cents is the service layer's job). */
  amountKes: number;
  /** Normalized Kenyan MSISDN (2547XXXXXXXX / 2541XXXXXXXX). */
  phoneNumber: string;
  /** MaliHub's own reference, persisted on the Payment row BEFORE this call. */
  externalReference: string;
  /** Optional payer display name (buyer's profile name when available). */
  customerName?: string;
};

export type PayheroStkPushResult = {
  reference: string;
  checkoutRequestId: string;
  /** Verbatim provider status, expected "QUEUED". Preserved, never interpreted. */
  status: string | null;
};

export type PayheroTransactionStatusResult = {
  status: PayheroTransactionStatus;
  /** True when the endpoint's vocabulary was extended past what we documented. */
  knownStatus: boolean;
  rawStatus: string;
  providerReference: string | null;
  checkoutRequestId: string | null;
};

export type FetchLike = (
  input: string | URL,
  init?: RequestInit
) => Promise<Pick<Response, "ok" | "status" | "json">>;

export type PayheroClient = {
  initiateStkPush(params: PayheroStkPushParams): Promise<PayheroStkPushResult>;
  getTransactionStatus(reference: string): Promise<PayheroTransactionStatusResult>;
};

/**
 * Builds a PayHero client. `fetchImpl` is injectable so tests can exercise the
 * full request/response handling — URL, headers, body, status mapping,
 * timeouts — without a network boundary.
 */
export function createPayheroClient(
  config: PayheroConfig,
  fetchImpl: FetchLike = globalThis.fetch
): PayheroClient {
  const authorization = `Basic ${config.authToken}`;

  async function request(path: string, init: RequestInit): Promise<Pick<Response, "ok" | "status" | "json">> {
    const url = `${config.apiUrl}${path}`;
    let response: Pick<Response, "ok" | "status" | "json">;
    try {
      response = await fetchImpl(url, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          Authorization: authorization,
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (error) {
      // AbortSignal.timeout() rejects with a TimeoutError DOMException; a
      // caller-initiated abort is impossible here (we own the signal), so an
      // abort is always the budget expiring.
      if (error instanceof Error && error.name === "TimeoutError") {
        safeLog("payhero.request_timeout", { path, timeoutMs: config.timeoutMs });
        throw new PayheroClientError("timeout", "PayHero did not respond in time.");
      }
      safeLog("payhero.request_network_error", {
        path,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw new PayheroClientError("network", "PayHero could not be reached.");
    }

    if (!response.ok) {
      const kind = response.status >= 500 ? "http_error" : "http_rejected";
      safeLog("payhero.request_http_error", { path, httpStatus: response.status, kind });
      throw new PayheroClientError(
        kind,
        kind === "http_error"
          ? "PayHero reported a server-side error."
          : "PayHero refused the request.",
        response.status
      );
    }

    return response;
  }

  async function parseJson(
    response: Pick<Response, "json">,
    path: string
  ): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      safeLog("payhero.request_invalid_json", { path });
      throw new PayheroClientError(
        "invalid_response",
        "PayHero returned a response that was not valid JSON."
      );
    }
  }

  return {
    async initiateStkPush(params) {
      // The request shape is exactly the documented contract. `channel_id`,
      // `provider` and `callback_url` come from server configuration; only
      // amount, phone, reference and customer name are per-payment inputs.
      const body = {
        amount: params.amountKes,
        phone_number: params.phoneNumber,
        channel_id: config.channelId,
        provider: PAYHERO_STK_PROVIDER,
        external_reference: params.externalReference,
        callback_url: config.callbackUrl,
        ...(params.customerName ? { customer_name: params.customerName } : {}),
      };

      const response = await request("/payments", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const payload = payheroStkInitiationResponseSchema.safeParse(
        await parseJson(response, "/payments")
      );
      if (!payload.success) {
        safeLog("payhero.stk_malformed_response", {});
        throw new PayheroClientError(
          "invalid_response",
          "PayHero's initiation response did not match the documented shape."
        );
      }
      const data = payload.data;

      if (!data.success) {
        // A well-formed refusal (2xx + success:false). PayHero's message is
        // provider copy about our own request, not a credential; it is still
        // treated as provider-internal and only logged, not surfaced verbatim.
        safeLog("payhero.stk_declined", {});
        throw new PayheroClientError(
          "declined",
          "PayHero declined the payment request."
        );
      }

      if (!data.reference || !data.CheckoutRequestID) {
        // A "successful" initiation without the identifiers we must persist is
        // worse than a failure: there would be nothing to correlate a callback
        // or a status check against. Treat as malformed.
        safeLog("payhero.stk_missing_identifiers", {
          hasReference: Boolean(data.reference),
          hasCheckoutRequestId: Boolean(data.CheckoutRequestID),
        });
        throw new PayheroClientError(
          "invalid_response",
          "PayHero's initiation response was missing transaction identifiers."
        );
      }

      safeLog("payhero.stk_queued", { status: data.status ?? null });
      return {
        reference: data.reference,
        checkoutRequestId: data.CheckoutRequestID,
        status: data.status ?? null,
      };
    },

    async getTransactionStatus(reference) {
      const response = await request(
        `/transaction-status?reference=${encodeURIComponent(reference)}`,
        { method: "GET" }
      );
      const payload = payheroTransactionStatusResponseSchema.safeParse(
        await parseJson(response, "/transaction-status")
      );
      if (!payload.success) {
        safeLog("payhero.status_malformed_response", {});
        throw new PayheroClientError(
          "invalid_response",
          "PayHero's transaction-status response did not match the documented shape."
        );
      }
      const data = payload.data;

      if (!data.success) {
        safeLog("payhero.status_declined", { rawStatus: data.status });
        throw new PayheroClientError(
          "declined",
          "PayHero reported a failed status lookup."
        );
      }

      const rawStatus = data.status;
      const knownStatus = isPayheroTransactionStatus(rawStatus);
      safeLog("payhero.status_received", { rawStatus, knownStatus });

      return {
        // Unknown statuses are surfaced to the caller as the closest safe
        // bucket (QUEUED = "no final answer yet") plus `knownStatus: false` —
        // the caller must never map an unrecognized word to SUCCESS or FAILED.
        status: knownStatus ? (rawStatus as PayheroTransactionStatus) : "QUEUED",
        knownStatus,
        rawStatus,
        providerReference: data.provider_reference ?? data.third_party_reference ?? null,
        checkoutRequestId: data.CheckoutRequestID ?? null,
      };
    },
  };
}

/** Structured, credential-free breadcrumbs. `context` carries only whitelisted keys. */
function safeLog(event: string, context: Record<string, unknown>): void {
  console.warn(`[payhero] ${event}`, context);
}

// ─── Inbound callback contract ───────────────────────────────────────────────

/**
 * The documented PayHero STK callback envelope:
 *
 *   {
 *     "forward_url": "",
 *     "response": {
 *       "Amount": 10,
 *       "CheckoutRequestID": "ws_CO_…",
 *       "ExternalReference": "INV-009",
 *       "MerchantRequestID": "3202-70921557-1",
 *       "MpesaReceiptNumber": "SAE3YULR0Y",
 *       "Phone": "+254709099876",
 *       "ResultCode": 0,
 *       "ResultDesc": "The service request is processed successfully.",
 *       "Status": "Success"
 *     },
 *     "status": true
 *   }
 *
 * PayHero documents NO HMAC/signature mechanism for this callback, so nothing
 * here invents one. Security is application-level, enforced by the callback
 * service: the reference must resolve to a real Payment row, the amount must
 * equal that row's authoritative amount, and financial effects are gated by
 * conditional updates and the order state machine — the payload is a claim,
 * never an instruction.
 *
 * The schema is deliberately tolerant of extra keys (providers add fields)
 * but strict about the identifiers and types the processing pipeline needs.
 */
export const payheroCallbackSchema = z
  .object({
    forward_url: z.string().optional().nullable(),
    status: z.boolean().optional(),
    response: z.object({
      Amount: z.number(),
      CheckoutRequestID: z.string().min(1),
      ExternalReference: z.string().min(1),
      MerchantRequestID: z.string().optional().nullable(),
      MpesaReceiptNumber: z.string().optional().nullable(),
      Phone: z.string().optional().nullable(),
      ResultCode: z.number(),
      ResultDesc: z.string().optional().nullable(),
      Status: z.string().min(1),
    }),
  })
  .passthrough();

export type PayheroCallbackPayload = z.infer<typeof payheroCallbackSchema>;

/**
 * Fields stripped from a callback before it is persisted as
 * `PaymentEvent.rawPayload` — the redacted copy kept for reconciliation.
 * Mirrors the privacy rule the schema documents (`raw`, `signature`, `payer`,
 * `phone_number` in the backend's `_strip_sensitive` list): the payer's phone
 * number is PII the event log does not need. The VERBATIM payload is stored
 * separately, on `Payment.rawCallbackPayload`, exactly as that field documents.
 *
 * Returns a NEW object; the input is never mutated.
 */
export function redactPayheroCallback(payload: PayheroCallbackPayload): Record<string, unknown> {
  const redacted = structuredClone(payload) as Record<string, unknown>;
  const response = redacted.response as Record<string, unknown> | undefined;
  if (response && "Phone" in response) {
    response.Phone = "[redacted]";
  }
  return redacted;
}
