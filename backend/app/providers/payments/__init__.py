"""Payment provider adapters.

Public surface of this package — import from here, not from the submodules:

    from app.providers.payments import PaymentProvider, get_payment_registry

`base` holds the contract and the provider-neutral vocabulary, `registry` holds
the lookup, and each concrete adapter lives in its own module.
"""

from __future__ import annotations

from app.providers.payments.base import (
    Payer,
    PaymentEventType,
    PaymentInitiationRequest,
    PaymentInitiationResult,
    PaymentMethod,
    PaymentProvider,
    PaymentProviderName,
    PaymentStatus,
    PaymentStatusRequest,
    PaymentStatusResult,
    PaymentVerificationResult,
    ProviderCapability,
    RefundRequest,
    RefundResult,
    WebhookEnvelope,
    WebhookEvent,
)
from app.providers.payments.payhero import PayHeroProvider
from app.providers.payments.registry import (
    PaymentProviderRegistry,
    build_default_registry,
    get_payment_registry,
    reset_payment_registry,
)

__all__ = [
    "PayHeroProvider",
    "Payer",
    "PaymentEventType",
    "PaymentInitiationRequest",
    "PaymentInitiationResult",
    "PaymentMethod",
    "PaymentProvider",
    "PaymentProviderName",
    "PaymentProviderRegistry",
    "PaymentStatus",
    "PaymentStatusRequest",
    "PaymentStatusResult",
    "PaymentVerificationResult",
    "ProviderCapability",
    "RefundRequest",
    "RefundResult",
    "WebhookEnvelope",
    "WebhookEvent",
    "build_default_registry",
    "get_payment_registry",
    "reset_payment_registry",
]
