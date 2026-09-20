"""The payment provider contract.

    PaymentService  (app/services/payment_service.py)
          │
          ▼
    PaymentProvider  ← this module
          │
          ├── PayHeroProvider   (providers/payments/payhero.py)  — first provider
          └── DarajaProvider    (future; deliberately absent)

Everything above the line is provider-agnostic and never changes when a new
processor is added. Everything below it is one adapter per processor. The rule
that keeps that true: **no provider-specific concept may appear in a type
defined here.** Not a field name, not an enum value, not a status string. If
PayHero needs to say something Daraja can't, it goes in `metadata` — and if
the application needs to *act* on it, it belongs in this contract instead.

Enum values match the Postgres enums in `prisma/schema.prisma` character for
character (`"PAYHERO"`, not `"payhero"`), so a value read from the provider
layer can be written to a column with no translation table and no chance of a
silent case mismatch. The schema is the source of truth; these mirror it.

Four operations, chosen because they are the intersection of what every
processor MaliHub will plausibly use actually offers:

* `initialize`          — ask the provider to collect money
* `check_status`        — ask the provider what happened (pull)
* `handle_webhook`      — verify and parse a provider callback (push)
* `verify_payment`      — independently confirm a claimed settlement

`check_status` and `verify_payment` look similar and are not. The first is
"what is the state of transaction X"; the second is "does a settlement the
customer or a support agent claims exists actually exist, with the right
amount, on our account" — the reconciliation and dispute path. Collapsing them
is how an app ends up trusting a customer-supplied receipt number.

None of this is wired to a database yet. Persistence (creating the `Payment`
row, the idempotent webhook state transition, `Order → PAID`) is Phase 9; see
`app/services/payment_service.py` for exactly where it goes.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
from enum import Enum, StrEnum
from typing import Any, ClassVar

from pydantic import BaseModel, ConfigDict, Field, field_validator

# The error types every adapter raises. Imported here so an adapter can only
# fail in ways the API already knows how to render.
from app.core.errors import (
    NotImplementedFeatureError,
    PaymentProviderError,
    ValidationError,
    WebhookVerificationError,
)

# ─── Provider-neutral vocabulary ─────────────────────────────────────────────


class PaymentProviderName(StrEnum):
    """Which processor moves the money. Mirrors the Prisma `PaymentProvider` enum."""

    PAYHERO = "PAYHERO"
    #: Reserved. A `Payment` must never carry this value until a
    #: `DarajaProvider` exists — see the enum comment in prisma/schema.prisma.
    DARAJA = "DARAJA"
    #: Money settled by hand (cash on delivery recorded by an admin). No
    #: external processor, so it has no adapter and must not be resolved
    #: through the registry.
    MANUAL = "MANUAL"


class PaymentMethod(StrEnum):
    """The channel the customer pays through. Mirrors Prisma `PaymentMethod`.

    A *channel*, not a processor: `MOBILE_MONEY` covers M-Pesa, Airtel Money
    and anything else an aggregator fronts. Which aggregator handled it is
    `PaymentProviderName`. Conflating the two is what the old
    `PaymentMethod.MPESA` value did, and why it was renamed in Phase 8.
    """

    MOBILE_MONEY = "MOBILE_MONEY"
    CARD = "CARD"
    BANK_TRANSFER = "BANK_TRANSFER"
    CASH_ON_DELIVERY = "CASH_ON_DELIVERY"


class PaymentStatus(StrEnum):
    """Lifecycle state. Mirrors Prisma `PaymentStatus`."""

    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"
    REFUNDED = "REFUNDED"

    @property
    def is_terminal(self) -> bool:
        """Terminal states must never transition again.

        Enforcing this is what makes a provider's retried webhook safe: the
        second delivery finds `SUCCESS` already written and is a no-op rather
        than a second settlement or a second notification.
        """
        return self in _TERMINAL_STATUSES

    @property
    def is_settled(self) -> bool:
        return self is PaymentStatus.SUCCESS


_TERMINAL_STATUSES = frozenset(
    {PaymentStatus.SUCCESS, PaymentStatus.FAILED, PaymentStatus.CANCELLED, PaymentStatus.REFUNDED}
)


class PaymentEventType(StrEnum):
    """What a provider callback is telling us. Deliberately small.

    Providers publish dozens of event types; the application only ever needs to
    react to a handful. An adapter maps its provider's full vocabulary onto
    these, and anything it cannot map becomes `UNKNOWN` — which is logged and
    acknowledged (so the provider stops retrying) but never applied.
    """

    PAYMENT_INITIATED = "payment_initiated"
    PAYMENT_PENDING = "payment_pending"
    PAYMENT_SUCCEEDED = "payment_succeeded"
    PAYMENT_FAILED = "payment_failed"
    PAYMENT_CANCELLED = "payment_cancelled"
    PAYMENT_REFUNDED = "payment_refunded"
    UNKNOWN = "unknown"


# ─── Contracts ───────────────────────────────────────────────────────────────

#: Fields that must never reach a log line or an API response by accident.
#: `safe_dump()` strips them; anything serializing these models should use it.
_SENSITIVE_FIELDS = frozenset({"raw", "raw_body", "signature", "payer", "phone_number"})


class _MoneyModel(BaseModel):
    """Shared config: forbid unknown keys, serialize enums by value."""

    model_config = ConfigDict(
        extra="forbid",
        use_enum_values=False,
        validate_assignment=True,
        str_strip_whitespace=True,
    )

    def safe_dump(self, **kwargs: Any) -> dict[str, Any]:
        """This model as a dict, with provider payloads and payer PII removed.

        Use this — not `model_dump()` — whenever the result could be logged or
        returned to a client. `raw` holds whatever a provider sent us, which
        routinely includes an MSISDN and occasionally a card fragment; `payer`
        holds one by construction.
        """
        data = self.model_dump(mode="json", **kwargs)
        return _strip_sensitive(data)


def _strip_sensitive(data: Any) -> Any:
    if isinstance(data, dict):
        return {
            key: ("[REDACTED]" if key in _SENSITIVE_FIELDS else _strip_sensitive(value))
            for key, value in data.items()
        }
    if isinstance(data, list):
        return [_strip_sensitive(item) for item in data]
    return data


class Payer(_MoneyModel):
    """Who is paying. The one piece of payer PII the provider layer needs.

    Kept as its own type so the redaction boundary is a single named thing
    rather than a scattering of `phone_number` fields, and so an adapter cannot
    quietly grow extra PII it doesn't need.
    """

    #: Normalized Kenyan MSISDN (`2547XXXXXXXX`) for mobile money. Use
    #: `toKenyanMsisdn()` on the frontend / its backend equivalent — providers
    #: are inconsistent about accepting `07…` or `+254…`.
    phone_number: str | None = None
    email: str | None = None
    #: Display name for the provider's prompt or receipt. Optional everywhere.
    full_name: str | None = None

    @field_validator("phone_number")
    @classmethod
    def _normalize_phone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        digits = "".join(character for character in value if character.isdigit())
        if digits.startswith("254"):
            normalized = digits
        elif digits.startswith("0"):
            normalized = f"254{digits[1:]}"
        elif digits.startswith(("7", "1")) and len(digits) == 9:
            normalized = f"254{digits}"
        else:
            # Returned rather than raised: an unnormalizable number is the
            # provider's problem to reject with a meaningful error, and failing
            # here would leak our validation rules into a 422 for what may be a
            # legitimate foreign format we haven't considered.
            return value
        if len(normalized) != 12:
            return value
        return normalized


class PaymentInitiationRequest(_MoneyModel):
    """Everything needed to ask a provider to collect money."""

    #: Integer minor units. Never a float, never a formatted string — see the
    #: money convention in ARCHITECTURE.md §6. A provider that wants major
    #: units does that division inside its own adapter.
    amount_cents: int = Field(gt=0)
    currency: str = Field(default="KES", min_length=3, max_length=3)
    method: PaymentMethod
    #: Our order number, handed to the provider as its external reference and
    #: stored on `payments.customer_reference`. Required: it is the join key
    #: when a callback arrives before we have a provider transaction id.
    customer_reference: str = Field(min_length=1, max_length=100)
    payer: Payer = Field(default_factory=Payer)
    description: str | None = Field(default=None, max_length=200)
    #: Where the provider should send its callback. Derived from
    #: `BACKEND_PUBLIC_URL`, never from a request header — a caller-controlled
    #: callback URL is how a payment gets confirmed to an attacker's server.
    callback_url: str | None = None
    #: Where to send a browser after a hosted checkout. Not used by STK-push
    #: style flows.
    return_url: str | None = None
    #: Free-form, provider-specific extras. Anything here is opaque to the
    #: application and must not be required for correctness.
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("currency")
    @classmethod
    def _upper_currency(cls, value: str) -> str:
        return value.upper()


class PaymentInitiationResult(_MoneyModel):
    """What a provider returned when asked to collect money."""

    provider: PaymentProviderName
    status: PaymentStatus
    #: The provider's transaction id, if it gave us one synchronously. Stored on
    #: `payments.provider_transaction_id` immediately — the callback can arrive
    #: before the HTTP response to our own request does, and without this
    #: written first there is nothing to match it against.
    provider_transaction_id: str | None = None
    provider_reference: str | None = None
    #: Hosted-checkout redirect, when the flow has one.
    redirect_url: str | None = None
    #: Text to show the customer ("Check your phone for an M-Pesa prompt").
    checkout_prompt: str | None = None
    expires_at: datetime | None = None
    #: Verbatim provider response. For debugging and dispute resolution only;
    #: never logged, never returned to a client. Use `safe_dump()`.
    raw: dict[str, Any] | None = None


class PaymentStatusRequest(_MoneyModel):
    """Look up a transaction. Exactly one identifier is required."""

    provider_transaction_id: str | None = None
    customer_reference: str | None = None

    @field_validator("customer_reference", "provider_transaction_id", mode="before")
    @classmethod
    def _blank_to_none(cls, value: Any) -> Any:
        return None if isinstance(value, str) and not value.strip() else value


class PaymentStatusResult(_MoneyModel):
    """The provider's current view of a transaction."""

    provider: PaymentProviderName
    status: PaymentStatus
    provider_transaction_id: str | None = None
    provider_reference: str | None = None
    customer_reference: str | None = None
    amount_cents: int | None = None
    currency: str | None = None
    #: Provider's own failure code, as a string. Daraja reports integers
    #: (0 accepted, 1032 cancelled by the user), PayHero reports strings — a
    #: string column holds both without a lossy cast. The adapter owns the
    #: mapping from its provider's vocabulary onto `PaymentStatus`.
    failure_code: str | None = None
    failure_reason: str | None = None
    payer_reference: str | None = None
    paid_at: datetime | None = None
    checked_at: datetime | None = None
    raw: dict[str, Any] | None = None


class WebhookEnvelope(_MoneyModel):
    """A provider callback, as received — before any interpretation.

    The raw body is carried as bytes, not a parsed dict, because signature
    verification has to run over the exact octets that arrived. Re-serializing
    a parsed body produces different bytes (key order, whitespace, number
    formatting) and a valid signature will then fail — or worse, an invalid one
    will pass because the attacker can pick a serialization that round-trips.
    """

    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)

    provider: PaymentProviderName
    raw_body: bytes = b""
    headers: dict[str, str] = Field(default_factory=dict)
    query_params: dict[str, str] = Field(default_factory=dict)
    #: Absolute path the callback hit, for adapters that route on it.
    path: str | None = None
    #: Source IP, for adapters whose provider publishes an allowlist. Logged in
    #: masked form only (see core/logging.py).
    source_ip: str | None = None


class WebhookEvent(_MoneyModel):
    """A verified, normalized callback.

    `verified=True` means the adapter confirmed authenticity by whatever
    mechanism its provider offers (HMAC signature, published IP range, a
    callback token in the payload). An adapter that cannot verify a callback
    MUST raise `WebhookVerificationError` rather than return `verified=False` —
    a boolean that a caller might forget to check is not a security control.
    """

    provider: PaymentProviderName
    event_type: PaymentEventType
    status: PaymentStatus | None = None
    verified: bool = True
    provider_transaction_id: str | None = None
    provider_reference: str | None = None
    customer_reference: str | None = None
    amount_cents: int | None = None
    currency: str | None = None
    failure_code: str | None = None
    failure_reason: str | None = None
    payer_reference: str | None = None
    occurred_at: datetime | None = None
    #: Provider's own event id — the natural idempotency key. Store it (or a
    #: Redis SETNX on it) so a retried delivery is processed once.
    provider_event_id: str | None = None
    raw: dict[str, Any] | None = None


class PaymentVerificationResult(_MoneyModel):
    """Independent confirmation that a claimed settlement is real.

    This is the reconciliation/dispute path, and it is deliberately a separate
    operation from `check_status`: `check_status` answers "what is the state of
    transaction X", this answers "does money we were told about actually exist
    and match". Confirming a customer-supplied receipt number against the
    provider is what stops "I paid, here's a screenshot".
    """

    provider: PaymentProviderName
    verified: bool
    status: PaymentStatus | None = None
    provider_reference: str | None = None
    provider_transaction_id: str | None = None
    amount_cents: int | None = None
    currency: str | None = None
    paid_at: datetime | None = None
    #: Why verification failed, when it did. Safe to surface: it describes a
    #: mismatch, not a secret.
    reason: str | None = None
    raw: dict[str, Any] | None = None


class ProviderCapability(_MoneyModel):
    """Non-secret description of a provider, safe to expose publicly.

    Backs `GET /api/v1/payments/providers`, which is what a checkout UI needs
    to render the right options. Contains no credentials, no account ids, and
    no internal URLs.
    """

    name: PaymentProviderName
    display_name: str
    supported_methods: tuple[PaymentMethod, ...] = ()
    #: Credentials present and the adapter implemented.
    configured: bool = False
    #: Configured *and* usable right now. False for the Phase 8 PayHero stub,
    #: which is configured-capable but not implemented.
    available: bool = False
    #: Human-readable reason `available` is false. Shown in an admin surface,
    #: never used as a control.
    unavailable_reason: str | None = None
    sandbox: bool = False


class RefundRequest(_MoneyModel):
    """A refund instruction. Not exercised in Phase 8; part of the contract
    because a provider abstraction that cannot refund is not finished, and
    adding it later would be a breaking change for every adapter."""

    provider_transaction_id: str | None = None
    provider_reference: str | None = None
    amount_cents: int = Field(gt=0)
    currency: str = "KES"
    reason: str | None = Field(default=None, max_length=200)
    customer_reference: str | None = None
    idempotency_key: str | None = None


class RefundResult(_MoneyModel):
    provider: PaymentProviderName
    status: PaymentStatus
    provider_transaction_id: str | None = None
    provider_reference: str | None = None
    amount_cents: int | None = None
    currency: str | None = None
    refunded_at: datetime | None = None
    raw: dict[str, Any] | None = None


# ─── The interface ───────────────────────────────────────────────────────────


class PaymentProvider(ABC):
    """One payment processor.

    Implementations must be:

    * **Stateless.** Constructed once at startup from `Settings`, shared across
      requests. Per-request state (an in-flight transaction) belongs in the
      database or Redis, never on the instance.
    * **Idempotency-aware.** Providers retry callbacks and clients retry
      requests. `initialize` should pass an idempotency key through where the
      provider supports one; `handle_webhook` must be safe to run twice.
    * **Silent about secrets.** Never log a credential, a raw payload, or a
      payer's phone number. `core.logging` redacts by key name as a backstop,
      but the adapter is the first line.
    * **Honest about failure.** Provider/network trouble → `PaymentProviderError`
      (502). A callback that fails verification → `WebhookVerificationError`
      (401). Not-yet-built → `NotImplementedFeatureError` (501). Never a bare
      `Exception`, which would surface as an opaque 500.
    """

    #: Which processor this adapter is. Set as a ClassVar so it can be read
    #: without constructing the adapter (the registry and the capability
    #: endpoint both need that).
    name: ClassVar[PaymentProviderName]
    display_name: ClassVar[str] = ""
    #: Channels this processor can actually handle. Drives what a checkout UI
    #: offers, and is checked before `initialize` so an unsupported method
    #: fails here rather than in a provider error response.
    supported_methods: ClassVar[frozenset[PaymentMethod]] = frozenset()
    #: True when the adapter talks to the provider's sandbox/testing host.
    sandbox: ClassVar[bool] = False

    @abstractmethod
    async def initialize(self, request: PaymentInitiationRequest) -> PaymentInitiationResult:
        """Ask the provider to collect money.

        Contract for implementations:
          * Validate `request.method in supported_methods` first.
          * Send `request.customer_reference` as the provider's external
            reference so callbacks can be matched without a lookup.
          * Return `status=PENDING` or `PROCESSING` for an asynchronous flow
            (STK push, hosted checkout). Returning `SUCCESS` here means the
            money has already moved, which only a synchronous flow may claim.
          * Never persist anything. The caller owns the `Payment` row.
        """

    @abstractmethod
    async def check_status(self, request: PaymentStatusRequest) -> PaymentStatusResult:
        """Pull the provider's current state for one transaction.

        Used by the reconciliation sweep for payments stuck in
        `PENDING`/`PROCESSING` past a timeout — the case where a callback never
        arrives. Must accept either identifier, because which one we have
        depends on how far the flow got.
        """

    @abstractmethod
    async def handle_webhook(self, envelope: WebhookEnvelope) -> WebhookEvent:
        """Verify, then parse, a provider callback.

        Verification comes first and is not optional: this endpoint is public
        and unauthenticated by necessity, so an unverified callback is just a
        POST from a stranger claiming someone paid. Raise
        `WebhookVerificationError` on any doubt.

        Parse the raw bytes exactly as received (`envelope.raw_body`) — see the
        note on `WebhookEnvelope` about re-serialization breaking signatures.
        """

    @abstractmethod
    async def verify_payment(self, *, provider_reference: str) -> PaymentVerificationResult:
        """Independently confirm a claimed settlement.

        Must compare the amount and currency the provider reports against what
        was expected, and must not treat "the provider has heard of this
        reference" as "this payment settled to us".
        """

    async def refund(self, request: RefundRequest) -> RefundResult:
        """Refund a settled payment.

        Not abstract: refunds are a later-phase concern, and forcing every
        adapter to write a stub that raises would obscure the four operations
        that matter now. The default is an honest 501.
        """
        raise NotImplementedFeatureError(
            f"{self.display_name or self.name.value} refunds are not implemented."
        )

    @abstractmethod
    def capability(self) -> ProviderCapability:
        """Non-secret self-description for `GET /api/v1/payments/providers`."""

    @abstractmethod
    def webhook_path(self) -> str:
        """Relative path this provider's callbacks are received on.

        Used both to build the `callback_url` handed to the provider at
        `initialize` time and to route an inbound callback to the right adapter.
        Must be provider-specific (`payments/webhooks/payhero`) — a single
        shared endpoint would have to guess the provider from the payload,
        before it could verify the payload.
        """

    # ─── Shared helpers ─────────────────────────────────────────────────────

    def supports(self, method: PaymentMethod) -> bool:
        return method in self.supported_methods

    def ensure_supports(self, method: PaymentMethod) -> None:
        """Fail fast on an unsupported channel, before any provider call."""
        if not self.supports(method):
            raise ValidationError(
                f"{self.display_name or self.name.value} does not support {method.value} payments.",
                details={
                    "method": method.value,
                    "supported": sorted(candidate.value for candidate in self.supported_methods),
                },
            )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<{type(self).__name__} {self.name.value} sandbox={self.sandbox}>"


__all__ = [
    "Payer",
    "PaymentEventType",
    "PaymentInitiationRequest",
    "PaymentInitiationResult",
    "PaymentMethod",
    "PaymentProvider",
    "PaymentProviderError",
    "PaymentProviderName",
    "PaymentStatus",
    "PaymentStatusRequest",
    "PaymentStatusResult",
    "PaymentVerificationResult",
    "ProviderCapability",
    "RefundRequest",
    "RefundResult",
    "ValidationError",
    "WebhookEnvelope",
    "WebhookEvent",
    "WebhookVerificationError",
]
