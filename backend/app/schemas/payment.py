"""API-facing payment schemas.

Phase 8 exposes exactly one payment endpoint — `GET /api/v1/payments/providers`
— so this module is correspondingly small. It is not a stub for the Phase 9
request/response schemas: those get written when the routes that use them
exist, against a real provider contract, rather than guessed at now.

What *is* here mirrors the generalized `Payment` model in
`prisma/schema.prisma`, and is the shape a client should expect a payment to
have on the wire. Enum values match the Postgres enums character for character.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.providers.payments.base import (
    PaymentMethod,
    PaymentProviderName,
    PaymentStatus,
    ProviderCapability,
)


class PaymentProviderCapabilityResponse(BaseModel):
    """One provider, as the checkout UI should see it.

    `available` is the field to render from, not `configured`: a provider can
    hold valid credentials and still not be implemented (which is exactly
    PayHero's state in Phase 8). `unavailable_reason` is human-readable and
    safe to show in an admin surface, but should never be shown to a buyer.
    """

    model_config = ConfigDict(extra="forbid", use_enum_values=True)

    name: PaymentProviderName
    display_name: str
    supported_methods: list[PaymentMethod] = Field(default_factory=list)
    configured: bool = False
    available: bool = False
    unavailable_reason: str | None = None
    sandbox: bool = False

    @classmethod
    def from_capability(cls, capability: ProviderCapability) -> PaymentProviderCapabilityResponse:
        return cls(
            name=capability.name,
            display_name=capability.display_name,
            supported_methods=list(capability.supported_methods),
            configured=capability.configured,
            available=capability.available,
            unavailable_reason=capability.unavailable_reason,
            sandbox=capability.sandbox,
        )


class PaymentProvidersResponse(BaseModel):
    """`GET /api/v1/payments/providers`."""

    model_config = ConfigDict(extra="forbid")

    #: The provider used when a caller doesn't name one. Lets a client show a
    #: default option without hardcoding a vendor.
    default_provider: PaymentProviderName
    providers: list[PaymentProviderCapabilityResponse]
    #: Provider enum values that exist in the schema but have no adapter, with
    #: the reason. Included so an integrator can distinguish "typo" from
    #: "planned, not built" without filing a ticket.
    reserved: list[dict[str, str]] = Field(default_factory=list)


class PaymentRead(BaseModel):
    """A payment as the API represents it. Wire mirror of the Prisma `Payment`.

    Not served by any Phase 8 route — declared because it fixes the contract
    Phase 9 will implement against, and because reviewing it now is cheaper
    than reviewing it under integration pressure.

    Note what is absent: no `raw_callback_payload`, no `metadata`. Provider
    payloads may contain an MSISDN or a card fragment and are for internal
    reconciliation only; if a client needs something from them, promote it to a
    typed field here rather than forwarding the blob.
    """

    model_config = ConfigDict(extra="forbid", from_attributes=True, use_enum_values=True)

    id: str
    order_id: str
    provider: PaymentProviderName
    method: PaymentMethod
    status: PaymentStatus
    amount_cents: int = Field(ge=0)
    currency: str
    provider_transaction_id: str | None = None
    provider_reference: str | None = None
    customer_reference: str
    #: Provider-reported payer handle. Exposed only on endpoints the payer
    #: themselves (or staff) can reach — never on a public or seller-facing one.
    payer_reference: str | None = None
    failure_code: str | None = None
    failure_reason: str | None = None
    retry_count: int = 0
    paid_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class PaymentProviderEventRead(BaseModel):
    """A normalized provider callback, for an admin/support view of what arrived.

    Deliberately excludes the raw payload — see `PaymentRead`.
    """

    model_config = ConfigDict(extra="forbid", use_enum_values=True)

    provider: PaymentProviderName
    event_type: str
    status: PaymentStatus | None = None
    verified: bool
    provider_transaction_id: str | None = None
    provider_reference: str | None = None
    customer_reference: str | None = None
    amount_cents: int | None = Field(default=None, ge=0)
    currency: str | None = None
    failure_code: str | None = None
    failure_reason: str | None = None
    provider_event_id: str | None = None
    occurred_at: datetime | None = None


class MoneyAmount(BaseModel):
    """An amount in integer minor units, with the currency it is denominated in.

    Reusable across orders, payments and refunds. Exists so that no endpoint
    ever accepts a bare `amount: float` — the single most common way a
    marketplace loses money to rounding.
    """

    model_config = ConfigDict(extra="forbid")

    amount_cents: int = Field(gt=0)
    currency: str = Field(default="KES", min_length=3, max_length=3)

    @property
    def major_units(self) -> float:
        """For display only. Never round-trip this back into a payment."""
        return self.amount_cents / 100


class UnknownPaymentMetadata(BaseModel):
    """Escape hatch for provider-specific detail that has nowhere typed to go.

    Mirrors `payments.metadata` (JSONB). Using it is a smell worth a comment at
    the call site: if the application branches on a value, that value should be
    a typed field on the model instead.
    """

    model_config = ConfigDict(extra="allow")

    data: dict[str, Any] = Field(default_factory=dict)


__all__ = [
    "MoneyAmount",
    "PaymentProviderCapabilityResponse",
    "PaymentProviderEventRead",
    "PaymentProvidersResponse",
    "PaymentRead",
    "UnknownPaymentMetadata",
]
