"""PayHero — MaliHub's first payment provider.

╔══════════════════════════════════════════════════════════════════════════╗
║  THIS IS A TYPED STUB. Phase 8 does not call PayHero.                    ║
║                                                                          ║
║  No method in this file makes a network request. Every operation raises   ║
║  `NotImplementedFeatureError` (HTTP 501, `not_implemented`) with a        ║
║  message naming the work item. Real integration is Phase 9.               ║
╚══════════════════════════════════════════════════════════════════════════╝

What this file *is* good for today:

* It proves the `PaymentProvider` contract in `base.py` is implementable by a
  real Kenyan processor without the contract bending — the point of writing
  the abstraction before the integration.
* It fixes the shape of the Phase 9 work: the exact request/response types, the
  configuration keys, the webhook path, and the verification requirements are
  all decided and reviewable now, instead of emerging mid-integration.
* It reports honestly. `capability()` says `configured=True/False` from real
  config and `available=False` with the reason, so `GET /api/v1/payments/providers`
  never advertises a payment option that cannot be taken. A checkout UI built
  against it in Phase 8 will render "not available yet", not a button that 501s.

──────────────────────────────────────────────────────────────────────────────
 PHASE 9 IMPLEMENTATION CHECKLIST
──────────────────────────────────────────────────────────────────────────────
 PayHero's v2 API, per https://docs.payhero.co.ke (verified against the public
 docs during Phase 8 — re-confirm before writing code, gateways change):

   POST {PAYHERO_BASE_URL}/payments
     Authorization: Basic base64(API_USERNAME:API_PASSWORD)
     Content-Type: application/json
     {
       "amount":             <int>,     # PayHero takes a whole-number amount
       "phone_number":       "0787677676",
       "channel_id":         133,       # our registered payment channel
       "provider":           "m-pesa",  # the rail *within* PayHero
       "external_reference": "MH-8F3K2",# ← our customer_reference
       "customer_name":      "…",       # optional
       "callback_url":       "https://…/api/v1/payments/webhooks/payhero",
       "credential_id":      "…"        # optional: our own Daraja keys
     }
   GET  {PAYHERO_BASE_URL}/transactions/{id}   # status / reconciliation
   Refund and wallet-balance endpoints also exist; not needed for the first flow.

 1. HTTP client
    One shared `httpx.AsyncClient` created at startup, closed on shutdown, with
    `PAYHERO_TIMEOUT_SECONDS` applied. Per-request clients leak connections and
    lose TLS session reuse.

 2. Credentials
    `PAYHERO_API_USERNAME` + `PAYHERO_API_PASSWORD` → Basic auth header. Built
    per request from `SecretStr`; never stored on the instance, never logged.
    `core.logging` redacts by key name, but don't rely on that as the plan.

 3. Amount units — the single most likely bug in this integration
    Our contract (and `payments.amount_cents`) is integer *minor* units.
    PayHero's `amount` is a whole number in KES. The conversion lives here and
    only here, and it must round-trip: `amount_cents == 150_000` → `1500`, and
    a callback reporting `1500` → `150_000`. Add a unit test for a non-round
    amount (`150_050`) before anything else; confirm with PayHero whether
    fractional KES is accepted or truncated, and reject it explicitly rather
    than silently rounding.

 4. Channel id
    `PAYHERO_CHANNEL_ID` is an integer on PayHero's side, a string in config so
    "unset" is unambiguous. Parse once at construction, fail at startup, not at
    first payment.

 5. `initialize()`
    Validate the method against `supported_methods`, build the payload, POST,
    then map the response onto `PaymentInitiationResult`. Return
    `status=PENDING` and the provider's transaction id — an STK push has not
    collected anything yet, it has asked the customer's phone to prompt. Do not
    return `SUCCESS` from here.

 6. `callback_url`
    Build it from `BACKEND_PUBLIC_URL` + `webhook_path()`. Never from a request
    header: a caller-supplied callback URL redirects payment confirmations to
    wherever the caller chose.

 7. `handle_webhook()` — verification is the whole job
    This endpoint is public and unauthenticated by necessity, so an unverified
    callback is a stranger POSTing "someone paid you". Before parsing:
      a. Establish what PayHero actually signs. Its docs describe a callback
         payload; whether it HMAC-signs it, and with which secret
         (`PAYHERO_WEBHOOK_SECRET`), MUST be confirmed with PayHero support in
         Phase 9. Do not guess a scheme.
      b. If a signature exists: `hmac.compare_digest` over the exact
         `envelope.raw_body` bytes. Not a re-serialized dict — see
         `WebhookEnvelope`'s docstring.
      c. If no signature exists, fall back to *confirmation by callback*: treat
         the payload only as a hint, then call `check_status()` against PayHero
         and act on what PayHero says over an authenticated channel. This is
         slower and is the correct answer when a provider cannot sign.
      d. Raise `WebhookVerificationError` on any doubt. Log the reason and the
         source IP (masked); never log the payload or any secret.
    Then map the event onto `PaymentEventType`/`PaymentStatus`, and carry
    PayHero's event id into `provider_event_id` for idempotency.

 8. Idempotency
    PayHero retries callbacks. `provider_event_id` (or
    `provider_transaction_id` + status) is the key: `RedisGateway.set_if_absent`
    with a TTL, or the unique index already on
    `payments.provider_transaction_id`. A duplicate delivery must be
    acknowledged 200 without re-applying the transition, re-notifying the
    buyer, or re-incrementing a seller's `total_sales`.

 9. `check_status()` / reconciliation
    Poll for payments stuck in `PENDING`/`PROCESSING` past a timeout — the
    callback-never-arrives case. Bound the sweep, and respect PayHero's rate
    limits (`services/rate_limit.py` is the wrong tool here; this is our own
    outbound budget).

 10. `verify_payment()`
    Compare the amount and currency PayHero reports against the expected
    `Payment` row. "PayHero recognizes this reference" is not "this settled to
    us for the right amount". This is the defence against a doctored receipt.

 11. Never trust the client on money
    The amount comes from the `Order`/`Payment` row, computed server-side. A
    client-supplied amount is how a KES 100 payment buys a KES 100,000 phone.

 12. Testing
    PayHero sandbox credentials, `PAYHERO_ENABLED=false` everywhere except the
    sandbox environment, and contract tests that exercise the mapping with
    recorded payloads — no live calls in CI.
"""

from __future__ import annotations

from typing import Any

from app.core.config import Settings, get_settings
from app.core.errors import NotImplementedFeatureError
from app.core.logging import get_logger
from app.providers.payments.base import (
    PaymentInitiationRequest,
    PaymentInitiationResult,
    PaymentMethod,
    PaymentProvider,
    PaymentProviderName,
    PaymentStatusRequest,
    PaymentStatusResult,
    PaymentVerificationResult,
    ProviderCapability,
    RefundRequest,
    RefundResult,
    WebhookEnvelope,
    WebhookEvent,
)

logger = get_logger(__name__)

PHASE_9 = "PayHero integration lands in Phase 9."


class PayHeroProvider(PaymentProvider):
    """Typed adapter for PayHero. Not yet implemented — see the module docstring.

    Constructed once at startup by `providers/payments/registry.py`. Holds no
    per-request state and makes no network calls.
    """

    name = PaymentProviderName.PAYHERO
    display_name = "PayHero"
    #: PayHero fronts M-Pesa (its `provider: "m-pesa"` request field), and its
    #: v2 API also exposes card and bank rails. Declared conservatively: only
    #: mobile money is documented end-to-end for the STK-push flow Phase 9
    #: implements first. Widen this when the others are actually verified.
    supported_methods = frozenset({PaymentMethod.MOBILE_MONEY})

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        # Read-only view of configuration. Secrets stay as SecretStr and are
        # only ever unwrapped inside a request builder in Phase 9 — never
        # stored as plain strings on the instance.
        self._channel_id: str | None = self._settings.payhero_channel_id
        # ClassVars can't depend on config, so `sandbox` is reported through
        # `capability()` rather than the class attribute.
        self._sandbox = "testing" in self._settings.payhero_base_url.lower()

    sandbox = False  # class-level default; the real value is config-derived

    # ─── Configuration state ────────────────────────────────────────────────

    @property
    def has_credentials(self) -> bool:
        return bool(self._settings.payhero_api_username and self._settings.payhero_api_password)

    @property
    def is_enabled(self) -> bool:
        return bool(self._settings.payhero_enabled)

    @property
    def is_ready(self) -> bool:
        """Would this adapter work if the Phase 9 code were present?"""
        return self.is_enabled and self.has_credentials and bool(self._channel_id)

    @property
    def unavailable_reason(self) -> str:
        if not self.is_enabled:
            return "Disabled: PAYHERO_ENABLED is false."
        if not self.has_credentials:
            return "PAYHERO_API_USERNAME / PAYHERO_API_PASSWORD are not set."
        if not self._channel_id:
            return "PAYHERO_CHANNEL_ID is not set."
        return "Adapter not implemented yet — Phase 9."

    # ─── Contract: the four operations (all stubs) ──────────────────────────

    async def initialize(self, request: PaymentInitiationRequest) -> PaymentInitiationResult:
        """STK push / payment creation. NOT IMPLEMENTED — no request is sent.

        Phase 9: POST `{PAYHERO_BASE_URL}/payments` (see checklist items 3–6).
        """
        self._refuse(
            "initialize",
            "PayHero payment initiation is not implemented. "
            f"{PHASE_9} Nothing was sent to PayHero and no money moved.",
            method=request.method.value,
            amount_cents=request.amount_cents,
            currency=request.currency,
        )

    async def check_status(self, request: PaymentStatusRequest) -> PaymentStatusResult:
        """Transaction status lookup. NOT IMPLEMENTED — no request is sent.

        Phase 9: GET `{PAYHERO_BASE_URL}/transactions/{id}` (checklist item 9).
        """
        self._refuse(
            "check_status",
            f"PayHero status lookup is not implemented. {PHASE_9} Nothing was sent to PayHero.",
            has_transaction_id=request.provider_transaction_id is not None,
            has_customer_reference=request.customer_reference is not None,
        )

    async def handle_webhook(self, envelope: WebhookEnvelope) -> WebhookEvent:
        """Callback verification + parsing. NOT IMPLEMENTED.

        Phase 9: establish and enforce PayHero's signature scheme before
        parsing anything (checklist items 7–8). Until then this raises rather
        than returning an unverified event — an adapter that cannot verify a
        callback must not accept one.
        """
        self._refuse(
            "handle_webhook",
            "PayHero webhook handling is not implemented. "
            f"{PHASE_9} This endpoint deliberately rejects callbacks rather than "
            "accepting one it cannot verify.",
            body_bytes=len(envelope.raw_body),
        )

    async def verify_payment(self, *, provider_reference: str) -> PaymentVerificationResult:
        """Independent settlement confirmation. NOT IMPLEMENTED.

        Phase 9: checklist item 10.
        """
        self._refuse(
            "verify_payment",
            "PayHero payment verification is not implemented. "
            f"{PHASE_9} A claimed payment cannot be confirmed yet — do not treat "
            "any receipt as settled.",
        )

    async def refund(self, request: RefundRequest) -> RefundResult:
        self._refuse(
            "refund",
            f"PayHero refunds are not implemented. {PHASE_9}",
            amount_cents=request.amount_cents,
        )

    # ─── Contract: metadata (these DO work) ─────────────────────────────────

    def capability(self) -> ProviderCapability:
        """Honest, non-secret self-description.

        `available` is False until the Phase 9 adapter exists — even with valid
        credentials — because configured is not the same as implemented, and a
        checkout UI must be able to tell the difference.
        """
        return ProviderCapability(
            name=self.name,
            display_name=self.display_name,
            supported_methods=tuple(sorted(self.supported_methods, key=lambda m: m.value)),
            configured=self.is_ready,
            available=False,
            unavailable_reason=f"{self.unavailable_reason} {PHASE_9}".strip(),
            sandbox=self._sandbox,
        )

    def webhook_path(self) -> str:
        """Relative to the v1 API root: `/api/v1/payments/webhooks/payhero`.

        Provider-specific on purpose — a shared webhook path would have to
        guess the provider from an unverified payload in order to pick the
        adapter that verifies it.

        No route is mounted on this path in Phase 8. Registering it now would
        create a public endpoint that can only return 501, which is exactly the
        "fake production payment endpoint" Phase 8 is meant to avoid. Phase 9
        mounts it in `app/api/v1/router.py`.
        """
        return "payments/webhooks/payhero"

    # ─── Internals ──────────────────────────────────────────────────────────

    def _refuse(self, operation: str, message: str, **context: Any) -> None:
        """Log and raise. Always raises — declared `-> None` only so callers
        read naturally; `mypy` narrows it via the `NoReturn`-style usage below.

        Context values are chosen to be diagnostic without being sensitive:
        counts, booleans, amounts and currencies. Never the payer's phone
        number, never a payload, never a credential. (`core.logging` redacts by
        key name as a backstop; this is the first line.)
        """
        logger.warning(
            "payment_provider_not_implemented",
            extra={
                "event": "payment_provider_not_implemented",
                "provider": self.name.value,
                "operation": operation,
                "enabled": self.is_enabled,
                "has_credentials": self.has_credentials,
                "channel_id_configured": bool(self._channel_id),
                **context,
            },
        )
        raise NotImplementedFeatureError(
            message, details={"provider": self.name.value, "operation": operation}
        )
