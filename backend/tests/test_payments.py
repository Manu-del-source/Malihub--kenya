"""Payment architecture: the contract, the registry, and the PayHero stub.

The most important assertions in this file are negative ones. Phase 8 must not
make a payment call, must not expose a payment endpoint that can only fail, and
must not advertise a capability it doesn't have. Those are the properties that
make "Phase 9 implements PayHero" a real plan rather than a hope.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.errors import NotFoundError, NotImplementedFeatureError
from app.providers.payments import (
    Payer,
    PayHeroProvider,
    PaymentInitiationRequest,
    PaymentMethod,
    PaymentProvider,
    PaymentProviderName,
    PaymentStatus,
    PaymentStatusRequest,
    RefundRequest,
    WebhookEnvelope,
    build_default_registry,
    get_payment_registry,
)
from app.services.payment_service import PaymentService, get_payment_service
from tests.conftest import build_settings

# ─── Registry ────────────────────────────────────────────────────────────────


def test_only_payhero_is_registered() -> None:
    registry = build_default_registry(build_settings())
    assert registry.registered == (PaymentProviderName.PAYHERO,)


def test_daraja_is_reserved_but_not_registered() -> None:
    """Reserved in the schema and enum; no adapter, no Safaricom call anywhere."""
    registry = build_default_registry(build_settings())
    assert registry.get(PaymentProviderName.DARAJA) is None
    assert registry.get("daraja") is None

    with pytest.raises(NotFoundError) as excinfo:
        registry.resolve("DARAJA")
    # The message stays short and generic; the *reason* is structured detail,
    # which is what tells an integrator "planned" apart from "you typo'd".
    assert excinfo.value.details is not None
    reason = excinfo.value.details["reason"]
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
    assert excinfo.value.details is not None
    assert "PAYHERO" in excinfo.value.details["registered"]
    assert "DARAJA" in excinfo.value.details["reserved"]


def test_provider_names_are_case_insensitive() -> None:
    """URLs say `payhero`, the database says `PAYHERO`; both must resolve."""
    registry = build_default_registry(build_settings())
    assert registry.resolve("payhero").name is PaymentProviderName.PAYHERO
    assert registry.resolve("PayHero").name is PaymentProviderName.PAYHERO
    assert registry.resolve(PaymentProviderName.PAYHERO).name is PaymentProviderName.PAYHERO


def test_default_provider_comes_from_configuration() -> None:
    settings = build_settings(payments_default_provider="MANUAL")
    registry = build_default_registry(settings)
    with pytest.raises(NotFoundError):
        registry.resolve(None, settings=settings)


def test_duplicate_registration_is_refused() -> None:
    from app.providers.payments.registry import PaymentProviderRegistry

    first = PayHeroProvider(build_settings())
    with pytest.raises(ValueError, match="Duplicate payment provider"):
        PaymentProviderRegistry([first, first])


# ─── PayHero stub ────────────────────────────────────────────────────────────


@pytest.fixture
def payhero() -> PayHeroProvider:
    return PayHeroProvider(
        build_settings(
            payhero_enabled=True,
            payhero_api_username="test-username",
            payhero_api_password="test-password",
            payhero_channel_id="133",
        )
    )


@pytest.mark.parametrize(
    "call",
    [
        lambda provider: provider.initialize(
            PaymentInitiationRequest(
                amount_cents=150_000,
                currency="KES",
                method=PaymentMethod.MOBILE_MONEY,
                customer_reference="MH-TEST-1",
                payer=Payer(phone_number="0712345678"),
            )
        ),
        lambda provider: provider.check_status(PaymentStatusRequest(customer_reference="MH-TEST-1")),
        lambda provider: provider.handle_webhook(
            WebhookEnvelope(provider=PaymentProviderName.PAYHERO, raw_body=b'{"status":"success"}')
        ),
        lambda provider: provider.verify_payment(provider_reference="QGH83HD72S"),
        lambda provider: provider.refund(
            RefundRequest(provider_reference="QGH83HD72S", amount_cents=150_000)
        ),
    ],
    ids=["initialize", "check_status", "handle_webhook", "verify_payment", "refund"],
)
def test_every_payhero_operation_is_a_stub_that_raises_501(payhero: PayHeroProvider, call: Any) -> None:
    """No operation reaches the network; each names the Phase 9 work item."""
    import asyncio

    with pytest.raises(NotImplementedFeatureError) as excinfo:
        asyncio.run(call(payhero))
    assert excinfo.value.status_code == 501
    assert excinfo.value.code == "not_implemented"
    assert "Phase 9" in excinfo.value.message


def test_payhero_makes_no_network_call(payhero: PayHeroProvider, monkeypatch: pytest.MonkeyPatch) -> None:
    """The strongest form of the guarantee above: httpx cannot even be reached."""
    import asyncio

    import httpx

    def _explode(*args: Any, **kwargs: Any) -> Any:
        raise AssertionError("PayHero stub attempted an outbound HTTP request")

    monkeypatch.setattr(httpx.AsyncClient, "post", _explode)
    monkeypatch.setattr(httpx.AsyncClient, "get", _explode)
    monkeypatch.setattr(httpx.AsyncClient, "request", _explode)

    with pytest.raises(NotImplementedFeatureError):
        asyncio.run(
            payhero.initialize(
                PaymentInitiationRequest(
                    amount_cents=100,
                    method=PaymentMethod.MOBILE_MONEY,
                    customer_reference="MH-TEST-2",
                )
            )
        )


def test_payhero_capability_is_honest_about_availability(payhero: PayHeroProvider) -> None:
    """Configured ≠ available. A checkout UI must be able to tell them apart."""
    capability = payhero.capability()
    assert capability.name is PaymentProviderName.PAYHERO
    assert capability.configured is True  # credentials + channel id present
    assert capability.available is False  # but the adapter is not implemented
    assert capability.unavailable_reason is not None
    assert "Phase 9" in capability.unavailable_reason
    assert PaymentMethod.MOBILE_MONEY in capability.supported_methods


def test_payhero_capability_reports_unconfigured_state() -> None:
    provider = PayHeroProvider(build_settings())  # PAYHERO_ENABLED=false
    capability = provider.capability()
    assert capability.configured is False
    assert capability.available is False
    assert "PAYHERO_ENABLED is false" in (capability.unavailable_reason or "")


def test_payhero_capability_exposes_no_secrets(payhero: PayHeroProvider) -> None:
    serialized = str(payhero.capability().safe_dump())
    for forbidden in ("test-username", "test-password", "133", "backend.payhero.co.ke"):
        assert forbidden not in serialized


def test_unsupported_method_is_refused_before_any_provider_call(payhero: PayHeroProvider) -> None:
    """Card is not in PayHero's declared support, so `ensure_supports` fires
    first — a clear 422 rather than a 501 from an unimplemented call."""
    from app.core.errors import ValidationError

    with pytest.raises(ValidationError) as excinfo:
        payhero.ensure_supports(PaymentMethod.CARD)
    assert excinfo.value.details is not None
    assert "MOBILE_MONEY" in excinfo.value.details["supported"]


def test_webhook_path_is_provider_specific(payhero: PayHeroProvider) -> None:
    """A shared webhook path would have to guess the provider from an
    unverified payload in order to choose the adapter that verifies it."""
    assert payhero.webhook_path() == "payments/webhooks/payhero"


def test_no_payment_or_webhook_route_is_mounted() -> None:
    """Phase 8 mounts exactly one payment route, and it is read-only.

    A public webhook endpoint that can only return 501 would advertise that
    MaliHub accepts payment callbacks when it cannot verify one.
    """
    from app.main import create_app

    app = create_app(build_settings())
    with TestClient(app) as client:
        assert client.get("/api/v1/payments/providers").status_code == 200
        for method in ("post", "put", "patch", "delete"):
            assert getattr(client, method)("/api/v1/payments").status_code in (404, 405)
        assert client.post("/api/v1/payments/webhooks/payhero", json={}).status_code == 404
        assert client.get("/api/v1/payments/some-id").status_code == 404


# ─── Providers endpoint ──────────────────────────────────────────────────────


def test_providers_endpoint_reports_the_truth(client: Any) -> None:
    response = client.get("/api/v1/payments/providers")
    assert response.status_code == 200
    body = response.json()

    assert body["default_provider"] == "PAYHERO"
    payhero = next(item for item in body["providers"] if item["name"] == "PAYHERO")
    assert payhero["available"] is False
    assert payhero["supported_methods"] == ["MOBILE_MONEY"]

    reserved = {item["provider"]: item["reason"] for item in body["reserved"]}
    assert "DARAJA" in reserved and "MANUAL" in reserved
    assert "Safaricom" in reserved["DARAJA"]


def test_providers_endpoint_needs_no_authentication(client: Any) -> None:
    """Public on purpose: it carries no credentials and a buyer may need it
    before signing in."""
    assert client.get("/api/v1/payments/providers").status_code == 200


def test_providers_endpoint_reflects_configuration(make_app: Any) -> None:
    app = make_app(
        payhero_enabled=True,
        payhero_api_username="u",
        payhero_api_password="p",
        payhero_channel_id="133",
    )
    with TestClient(app) as configured_client:
        body = configured_client.get("/api/v1/payments/providers").json()
    payhero = next(item for item in body["providers"] if item["name"] == "PAYHERO")
    assert payhero["configured"] is True
    assert payhero["available"] is False


# ─── Contract types ──────────────────────────────────────────────────────────


def test_enum_values_match_the_prisma_schema_exactly() -> None:
    """Character-for-character: no translation table between API and database."""
    assert [member.value for member in PaymentProviderName] == ["PAYHERO", "DARAJA", "MANUAL"]
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


def test_service_resolves_the_configured_default() -> None:
    service = PaymentService(build_default_registry(build_settings()), build_settings())
    assert isinstance(service.provider(), PaymentProvider)
    assert service.provider().name is PaymentProviderName.PAYHERO


def test_service_delegates_and_reports_a_501() -> None:
    """The orchestration seam works; the adapter behind it is honest."""
    import asyncio

    service = get_payment_service()
    with pytest.raises(NotImplementedFeatureError):
        asyncio.run(
            service.initiate_payment(
                PaymentInitiationRequest(
                    amount_cents=150_000,
                    method=PaymentMethod.MOBILE_MONEY,
                    customer_reference="MH-TEST-3",
                )
            )
        )


def test_service_rejects_an_unsupported_method_before_calling_the_provider() -> None:
    import asyncio

    from app.core.errors import ValidationError

    service = get_payment_service()
    with pytest.raises(ValidationError):
        asyncio.run(
            service.initiate_payment(
                PaymentInitiationRequest(
                    amount_cents=150_000,
                    method=PaymentMethod.CARD,
                    customer_reference="MH-TEST-4",
                )
            )
        )


def test_service_finds_a_provider_by_channel() -> None:
    """A checkout UI offers channels ("Pay with M-Pesa"), not processors."""
    service = get_payment_service()
    assert service.find_provider_for_method(PaymentMethod.MOBILE_MONEY) is not None
    assert service.find_provider_for_method(PaymentMethod.CARD) is None


def test_service_refuses_a_webhook_envelope_for_the_wrong_provider() -> None:
    """Defence in depth against a routing bug: verifying a PayHero payload with
    another provider's scheme would be worse than not verifying it."""
    import asyncio

    service = get_payment_service()
    with pytest.raises(NotFoundError):
        asyncio.run(
            service.process_webhook(
                "PAYHERO",
                WebhookEnvelope(provider=PaymentProviderName.DARAJA, raw_body=b"{}"),
            )
        )


def test_status_lookup_requires_an_identifier() -> None:
    import asyncio

    service = get_payment_service()
    with pytest.raises(NotFoundError):
        asyncio.run(service.get_payment_status(PaymentStatusRequest()))


def test_registry_singleton_is_stable() -> None:
    assert get_payment_registry() is get_payment_registry()
