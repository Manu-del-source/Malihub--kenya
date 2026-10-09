import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Server-only Paystack REST client.
 *
 * This module only initializes and verifies transactions and validates webhook
 * signatures. It does not settle MaliHub orders; callers must verify reference,
 * amount, currency, order ownership and idempotency before recording payment.
 */
export const PAYSTACK_API_URL = "https://api.paystack.co";
export const PAYSTACK_DEFAULT_TIMEOUT_MS = 15_000;

export type PaystackConfigSource = {
  PAYSTACK_SECRET_KEY?: string;
  PAYSTACK_CALLBACK_URL?: string;
  PAYSTACK_TIMEOUT_MS?: string;
};

export type PaystackConfig = {
  secretKey: string;
  callbackUrl: string;
  timeoutMs: number;
};

export type PaystackConfigResult =
  | { ok: true; config: PaystackConfig }
  | { ok: false; missing: string[]; invalid: string[] };

export function resolvePaystackConfig(env: PaystackConfigSource): PaystackConfigResult {
  const missing: string[] = [];
  const invalid: string[] = [];
  const secretKey = env.PAYSTACK_SECRET_KEY?.trim() ?? "";
  const callbackUrl = env.PAYSTACK_CALLBACK_URL?.trim() ?? "";
  const timeoutRaw = env.PAYSTACK_TIMEOUT_MS?.trim() ?? "";
  let timeoutMs = PAYSTACK_DEFAULT_TIMEOUT_MS;

  if (!secretKey) missing.push("PAYSTACK_SECRET_KEY");
  else if (!/^(sk_test_|sk_live_)[A-Za-z0-9]+$/.test(secretKey)) invalid.push("PAYSTACK_SECRET_KEY");

  if (!callbackUrl) missing.push("PAYSTACK_CALLBACK_URL");
  else {
    try {
      const parsed = new URL(callbackUrl);
      if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
        invalid.push("PAYSTACK_CALLBACK_URL");
      }
    } catch {
      invalid.push("PAYSTACK_CALLBACK_URL");
    }
  }

  if (timeoutRaw) {
    if (!/^\d+$/.test(timeoutRaw)) invalid.push("PAYSTACK_TIMEOUT_MS");
    else {
      timeoutMs = Number(timeoutRaw);
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) {
        invalid.push("PAYSTACK_TIMEOUT_MS");
      }
    }
  }

  if (missing.length || invalid.length) return { ok: false, missing, invalid };
  return { ok: true, config: { secretKey, callbackUrl, timeoutMs } };
}

export class PaystackClientError extends Error {
  constructor(
    message: string,
    public readonly kind: "not_configured" | "rejected" | "unavailable" | "invalid_response",
    public readonly status?: number
  ) {
    super(message);
    this.name = "PaystackClientError";
  }
}

type ApiEnvelope<T> = { status: boolean; message?: string; data?: T };

export type PaystackInitializeResult = {
  authorization_url: string;
  access_code: string;
  reference: string;
};

export type PaystackVerifiedTransaction = {
  id: number;
  status: string;
  reference: string;
  amount: number;
  currency: string;
  domain: "test" | "live" | string;
  paid_at?: string | null;
  channel?: string;
  metadata?: unknown;
};

export type PaystackClient = {
  initializeTransaction(input: {
    email: string;
    amountSubunits: number;
    reference: string;
    metadata?: Record<string, unknown>;
  }): Promise<PaystackInitializeResult>;
  verifyTransaction(reference: string): Promise<PaystackVerifiedTransaction>;
};

export function createPaystackClient(config: PaystackConfig): PaystackClient {
  async function request<T>(path: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetch(`${PAYSTACK_API_URL}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${config.secretKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...init.headers,
        },
        cache: "no-store",
      });
      let envelope: ApiEnvelope<T>;
      try {
        envelope = (await response.json()) as ApiEnvelope<T>;
      } catch {
        throw new PaystackClientError("Paystack returned an invalid response.", "invalid_response", response.status);
      }
      if (!response.ok || envelope.status !== true || envelope.data == null) {
        throw new PaystackClientError("Paystack did not accept the request.", "rejected", response.status);
      }
      return envelope.data;
    } catch (error) {
      if (error instanceof PaystackClientError) throw error;
      throw new PaystackClientError(
        "Paystack could not be reached. The transaction outcome may be unknown; verify before retrying.",
        "unavailable"
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async initializeTransaction(input) {
      if (!Number.isSafeInteger(input.amountSubunits) || input.amountSubunits <= 0) {
        throw new PaystackClientError("Invalid transaction amount.", "invalid_response");
      }
      const data = await request<PaystackInitializeResult>("/transaction/initialize", {
        method: "POST",
        body: JSON.stringify({
          email: input.email,
          amount: String(input.amountSubunits),
          currency: "KES",
          reference: input.reference,
          callback_url: config.callbackUrl,
          channels: ["mobile_money"],
          ...(input.metadata ? { metadata: input.metadata } : {}),
        }),
      });
      let url: URL;
      try {
        url = new URL(data.authorization_url);
      } catch {
        throw new PaystackClientError("Paystack returned an invalid checkout URL.", "invalid_response");
      }
      if (url.protocol !== "https:" || url.hostname !== "checkout.paystack.com") {
        throw new PaystackClientError("Paystack returned an untrusted checkout URL.", "invalid_response");
      }
      if (!data.access_code || !data.reference) {
        throw new PaystackClientError("Paystack response is missing transaction identifiers.", "invalid_response");
      }
      return data;
    },

    async verifyTransaction(reference) {
      if (!/^[A-Za-z0-9.=-]{1,100}$/.test(reference)) {
        throw new PaystackClientError("Invalid transaction reference.", "invalid_response");
      }
      const data = await request<PaystackVerifiedTransaction>(
        `/transaction/verify/${encodeURIComponent(reference)}`,
        { method: "GET" }
      );
      if (
        data.reference !== reference ||
        !Number.isSafeInteger(data.amount) ||
        typeof data.currency !== "string" ||
        typeof data.status !== "string"
      ) {
        throw new PaystackClientError("Paystack verification response did not match the request.", "invalid_response");
      }
      return data;
    },
  };
}

/** Verify x-paystack-signature against the exact raw request body bytes. */
export function verifyPaystackWebhookSignature(
  rawBody: string | Buffer,
  signature: string | null | undefined,
  secretKey: string
): boolean {
  if (!signature || !/^[a-f0-9]{128}$/i.test(signature) || !secretKey) return false;
  const expected = createHmac("sha512", secretKey).update(rawBody).digest();
  const received = Buffer.from(signature, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
