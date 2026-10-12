"""Payment architecture: the contract and the (deliberately empty) registry.

The most important assertions in this file are negative ones. This API must
not make a provider call, must not mount a webhook route it cannot verify, and
must not advertise a capability it doesn't have. Buyer payment collection
(Paystack) lives in the Next.js application; what this service keeps is the
provider-agnostic contract, the registry, and an honest capability report.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.errors import NotFoundError
from app.providers.payments import (
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
    WebhookEnvelope,
    WebhookEvent,
    build_default_registry,
    get_payment_registry,
)
from app.services.payment_service import PaymentService
from tests.conftest import build_settings

# ─── Registry ────────────────────────────────────────────────────────────────


def test_no_collection_provider_is_registered_here() -> None:
    """Paystack collection lives in the Next.js app; this service holds no
    provider credentials, so there is nothing to register."""
    registry = build_default_registry(build_settings())
    assert registry.registered == ()
    assert registry.capabilities() == []


def test_paystack_is_reserved_with_an_honest_reason() -> None:
    registry = build_default_registry(build_settings())
    assert registry.get(PaymentProviderName.PAYSTACK) is None
    with pytest.raises(NotFoundError) as excinfo:
        registry.resolve("PAYSTACK")
    reason = (excinfo.value.details or {}).get("reason", "")
    assert "Next.js" in reason
    assert "active provider" in reason


def test_payhero_is_reserved_as_retired() -> None:
    """The integration is gone; the name still answers 404 and says why, so a
    legacy client (or an operator) can distinguish retired from unknown."""
    registry = build_default_registry(build_settings())
    assert registry.get(PaymentProviderName.PAYHERO) is None
    with pytest.raises(NotFoundError) as excinfo:
        registry.resolve("payhero")  # case-insensitive
    reason = (excinfo.value.details or {}).get("reason", "")
    assert "RETIRED" in reason
    assert "historical" in reason


def test_daraja_is_reserved_but_not_registered() -> None:
    """Reserved in the schema and enum; no adapter, no Safaricom call anywhere."""
    registry = build_default_registry(build_settings())
    assert registry.get(PaymentProviderName.DARAJA) is None
    assert registry.get("daraja") is None

    with pytest.raises(NotFoundError) as excinfo:
        registry.resolve("DARAJA")
    reason = (excinfo.value.details or {}).get("reason", "")
    assert "planned future provider" in reason
    assert "no implementation" in reason
    assert "Safaricom" in reason


def test_manual_is_not_a_registry_provider() -> None:
    """Offline settlement has no external processor, so there is no adapter."""
    registry = build_default_registry(build_settings())
    with pytest.raises(NotFoundError) as excinfo:
        registry.resolve("MANUAL")
    assert "settled offline" in (excinfo.value.details or {}).get("reason", "")


def test_unknown_provider_is_a_404_that_lists_what_exists() -> None:
    registry = build_default_registry(build_settings())
    with pytest.raises(NotFoundError) as excinfo:
        registry.resolve("STRIPE")
    details = excinfo.value.details or {}
    assert details["registered"] == []
    assert "PAYSTACK" in details["reserved"]
    assert "PAYHERO" in details["reserved"]
    assert "DARAJA" in details["reserved"]


def test_default_provider_is_manual_and_still_unresolvable() -> None:
    """MANUAL is the only valid configured default (it needs no adapter), but
    resolving it through the registry must still 404 — the registry only
    hands out real processors."""
    registry = build_default_registry(build_settings())
    assert build_settings().payments_default_provider == "MANUAL"
    with pytest.raises(NotFoundError) as excinfo:
        registry.resolve(None, settings=build_settings())
    assert "MANUAL" in (excinfo.value.details or {}).get("reason", "")


def test_duplicate_registration_is_refused() -> None:
    from app.providers.payments.registry import PaymentProviderRegistry

    class _Placeholder(PaymentProvider):
        name = PaymentProviderName.DARAJA
        display_name = "Placeholder"
        supported_methods = frozenset()
        sandbox = False

        async def initialize(self, request: PaymentInitiationRequest) -> PaymentInitiationResult:
            raise NotImplementedError

        async def check_status(self, request: PaymentStatusRequest) -> PaymentStatusResult:
            raise NotImplementedError

        async def handle_webhook(self, envelope: WebhookEnvelope) -> WebhookEvent:
            raise NotImplementedError

        async def verify_payment(self, *, provider_reference: str) -> PaymentVerificationResult:
            raise NotImplementedError

        def capability(self) -> ProviderCapability:
            return ProviderCapability(name=PaymentProviderName.DARAJA, display_name="Placeholder")

        def webhook_path(self) -> str:
            return "payments/webhooks/placeholder"

    first = _Placeholder()
    with pytest.raises(ValueError, match="Duplicate payment provider"):
        PaymentProviderRegistry([first, first])


# ─── Mounted surface ─────────────────────────────────────────────────────────


def test_no_payment_or_webhook_route_is_mounted() -> None:
    """This API mounts exactly one payment route, and it is read-only.

    A public webhook endpoint that cannot verify a signature would advertise
    that MaliHub accepts payment callbacks when it cannot — that surface is
    removed, for PayHero and for any future name.
    """
    from app.main import create_app

    app = create_app(build_settings())
    with TestClient(app) as client:
        assert client.get("/api/v1/payments/providers").status_code == 200
        for method in ("post", "put", "patch", "delete"):
            assert getattr(client, method)("/api/v1/payments").status_code in (404, 405)
        assert client.post("/api/v1/payments/webhooks/paystack", json={}).status_code == 404
        assert client.post("/api/v1/payments/webhooks/payhero", json={}).status_code == 404
        assert client.get("/api/v1/payments/some-id").status_code == 404


# ─── Providers endpoint ──────────────────────────────────────────────────────


def test_providers_endpoint_reports_the_truth(client: Any) -> None:
    response = client.get("/api/v1/payments/providers")
    assert response.status_code == 200
    body = response.json()

    assert body["default_provider"] == "MANUAL"
    assert body["providers"] == []

    reserved = {item["provider"]: item["reason"] for item in body["reserved"]}
    assert set(reserved) == {"PAYSTACK", "PAYHERO", "DARAJA", "MANUAL"}
    assert "Next.js" in reserved["PAYSTACK"]
    assert "RETIRED" in reserved["PAYHERO"]
    assert "Safaricom" in reserved["DARAJA"]
    assert "settled offline" in reserved["MANUAL"]


def test_providers_endpoint_needs_no_authentication(client: Any) -> None:
    """Public on purpose: it carries no credentials and a buyer may need it
    before signing in."""
    assert client.get("/api/v1/payments/providers").status_code == 200


def test_providers_endpoint_carries_no_secrets(client: Any) -> None:
    """Whatever the environment holds, the capability report never leaks it."""
    import os

    response = client.get("/api/v1/payments/providers")
    serialized = response.text
    for key in ("PAYSTACK_SECRET_KEY", "PAYHERO_API_USERNAME", "PAYHERO_API_PASSWORD"):
        value = os.environ.get(key)
        if value:
            assert value not in serialized


# ─── Contract types ──────────────────────────────────────────────────────────


def test_enum_values_match_the_prisma_schema_exactly() -> None:
    """Character-for-character: no translation table between API and database."""
    assert [member.value for member in PaymentProviderName] == [
        "PAYSTACK",
        "PAYHERO",
        "DARAJA",
        "MANUAL",
    ]
    assert [member.value for member in PaymentMethod] == [
        "MOBILE_MONEY",
        "CARD",
        "BANK_TRANSFER",
        "CASH_ON_DELIVERY",
    ]
    assert [member.value for member in PaymentStatus] == [
        "PENDING",
        "PROCESSING",
        "SUCCESS",
        "FAILED",
        "CANCELLED",
        "REFUNDED",
    ]


def test_terminal_statuses_cannot_transition_again() -> None:
    """The guard that makes a retried provider callback a no-op."""
    assert PaymentStatus.SUCCESS.is_terminal
    assert PaymentStatus.FAILED.is_terminal
    assert PaymentStatus.CANCELLED.is_terminal
    assert PaymentStatus.REFUNDED.is_terminal
    assert not PaymentStatus.PENDING.is_terminal
    assert not PaymentStatus.PROCESSING.is_terminal


def test_phone_numbers_are_normalized_to_kenyan_msisdn() -> None:
    """The same normalization `toKenyanMsisdn()` does on the frontend."""
    for raw, expected in [
        ("0712345678", "254712345678"),
        ("+254712345678", "254712345678"),
        ("254712345678", "254712345678"),
        ("0112345678", "254112345678"),
        ("+254 712 345 678", "254712345678"),
    ]:
        assert Payer(phone_number=raw).phone_number == expected, raw


def test_initiation_request_rejects_a_non_positive_amount() -> None:
    from pydantic import ValidationError as PydanticValidationError

    with pytest.raises(PydanticValidationError):
        PaymentInitiationRequest(
            amount_cents=0,
            method=PaymentMethod.MOBILE_MONEY,
            customer_reference="MH-1",
        )


def test_initiation_request_requires_a_customer_reference() -> None:
    """It is the join key for a callback that arrives before a provider id."""
    from pydantic import ValidationError as PydanticValidationError

    with pytest.raises(PydanticValidationError):
        PaymentInitiationRequest(amount_cents=100, method=PaymentMethod.MOBILE_MONEY, customer_reference="")


def test_initiation_request_rejects_unknown_fields() -> None:
    """`extra="forbid"`: a provider-specific field cannot sneak into the
    shared contract, which is the whole rule that keeps it provider-neutral."""
    from pydantic import ValidationError as PydanticValidationError

    with pytest.raises(PydanticValidationError):
        PaymentInitiationRequest(
            amount_cents=100,
            method=PaymentMethod.MOBILE_MONEY,
            customer_reference="MH-1",
            mpesa_checkout_request_id="ws_CO_123",  # type: ignore[call-arg]
        )


def test_safe_dump_strips_payer_pii_and_raw_payloads() -> None:
    """Anything that might be logged or returned uses `safe_dump()`, not
    `model_dump()`."""
    request = PaymentInitiationRequest(
        amount_cents=150_000,
        method=PaymentMethod.MOBILE_MONEY,
        customer_reference="MH-1",
        payer=Payer(phone_number="0712345678", email="jane@example.com"),
    )
    dumped = request.safe_dump()
    assert "payer" in dumped
    assert dumped["payer"] == "[REDACTED]"
    assert "0712345678" not in str(dumped)
    assert "254712345678" not in str(dumped)
    # Non-sensitive fields survive — a dump that redacts everything is useless.
    assert dumped["amount_cents"] == 150_000
    assert dumped["customer_reference"] == "MH-1"


# ─── Service ─────────────────────────────────────────────────────────────────


def test_service_resolves_nothing_by_default() -> None:
    """No adapters registered → the configured default (MANUAL) still 404s
    through the registry; the service must not invent a processor."""
    service = PaymentService(build_default_registry(build_settings()), build_settings())
    assert service.default_provider_name is PaymentProviderName.MANUAL
    with pytest.raises(NotFoundError):
        service.provider()
    with pytest.raises(NotFoundError):
        service.provider("paystack")


def test_service_finds_no_provider_by_channel() -> None:
    """A checkout UI offers channels ("Pay with M-Pesa"), not processors; with
    no registered adapters the honest answer is None for every channel."""
    service = PaymentService(build_default_registry(build_settings()), build_settings())
    assert service.find_provider_for_method(PaymentMethod.MOBILE_MONEY) is None
    assert service.find_provider_for_method(PaymentMethod.CARD) is None


def test_service_refuses_a_webhook_envelope_for_any_provider() -> None:
    """There is no verifiable webhook surface in this API — not for Paystack,
    not for the retired PayHero. A routing bug that delivers a payload here
    must fail, not guess."""
    import asyncio

    service = PaymentService(build_default_registry(build_settings()), build_settings())
    for name in ("PAYSTACK", "PAYHERO"):
        with pytest.raises(NotFoundError):
            asyncio.run(
                service.process_webhook(
                    name,
                    WebhookEnvelope(provider=PaymentProviderName.PAYSTACK, raw_body=b"{}"),
                )
            )


def test_status_lookup_requires_an_identifier() -> None:
    import asyncio

    service = PaymentService(build_default_registry(build_settings()), build_settings())
    with pytest.raises(NotFoundError):
        asyncio.run(service.get_payment_status(PaymentStatusRequest()))


def test_registry_singleton_is_stable() -> None:
    assert get_payment_registry() is get_payment_registry()
