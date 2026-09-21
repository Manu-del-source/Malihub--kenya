"""MarketplaceProvider: the contract shape, exercised through a minimal fake.

No real adapter exists yet — see `docs/payments/provider-comparison.md` for
why (no Kenyan provider's marketplace/payout capability has been confirmed
against a sandbox). These tests exist to pin the *contract* down now, the
same way `test_payments.py` pins `PaymentProvider`'s shape down before
PayHero's real implementation lands: a future adapter is either compatible
with this shape or the test suite says so immediately.
"""

from __future__ import annotations

import asyncio
from typing import ClassVar

import pytest
from pydantic import ValidationError as PydanticValidationError

from app.core.errors import ValidationError
from app.providers.payments.base import PaymentProviderName, WebhookEnvelope
from app.providers.payments.marketplace import (
    MarketplaceCapability,
    MarketplaceProvider,
    PayoutRequest,
    PayoutResult,
    PayoutStatus,
    PayoutStatusRequest,
    PayoutStatusResult,
    PayoutWebhookEvent,
    SellerAccountStatusRequest,
    SellerAccountStatusResult,
    SellerOnboardingRequest,
    SellerOnboardingResult,
    SellerPayoutAccountStatus,
    SellerPayoutAccountType,
)


class _FakeMarketplaceProvider(MarketplaceProvider):
    """The smallest possible conforming adapter — in-memory, no network call.

    Stands in for "a real adapter, once one exists" so these tests exercise
    the base class's shared helpers (`supports`, `ensure_supports`) against
    something concrete, without asserting anything about a specific vendor.
    """

    name: ClassVar[PaymentProviderName] = PaymentProviderName.PAYHERO
    display_name: ClassVar[str] = "Fake Marketplace Provider"
    supported_account_types: ClassVar[frozenset[SellerPayoutAccountType]] = frozenset(
        {SellerPayoutAccountType.MPESA}
    )

    def __init__(self) -> None:
        self._accounts: dict[str, SellerPayoutAccountStatus] = {}
        self._payouts: dict[str, PayoutStatus] = {}

    async def create_seller_onboarding(self, request: SellerOnboardingRequest) -> SellerOnboardingResult:
        self.ensure_supports(request.account_type)
        provider_account_id = f"acct_{request.seller_id}"
        self._accounts[provider_account_id] = SellerPayoutAccountStatus.PENDING_VERIFICATION
        return SellerOnboardingResult(
            provider=self.name,
            provider_account_id=provider_account_id,
            status=SellerPayoutAccountStatus.PENDING_VERIFICATION,
            account_type=request.account_type,
        )

    async def get_seller_account(self, request: SellerAccountStatusRequest) -> SellerAccountStatusResult:
        status = self._accounts.get(request.provider_account_id)
        if status is None:
            raise ValidationError("Unknown provider_account_id.")
        return SellerAccountStatusResult(
            provider=self.name,
            provider_account_id=request.provider_account_id,
            status=status,
            account_type=SellerPayoutAccountType.MPESA,
        )

    async def create_payout(self, request: PayoutRequest) -> PayoutResult:
        status = self._accounts.get(request.provider_account_id)
        if status is None or not status.can_receive_payouts:
            raise ValidationError(
                "Payout account is not ACTIVE.",
                details={"provider_account_id": request.provider_account_id},
            )
        # Idempotency: the same key returns the same (already-recorded) result.
        if request.idempotency_key in self._payouts:
            return PayoutResult(
                provider=self.name,
                status=self._payouts[request.idempotency_key],
                provider_payout_id=f"payout_{request.idempotency_key}",
                settlement_reference=request.settlement_reference,
                amount_cents=request.amount_cents,
                currency=request.currency,
            )
        self._payouts[request.idempotency_key] = PayoutStatus.PENDING
        return PayoutResult(
            provider=self.name,
            status=PayoutStatus.PENDING,
            provider_payout_id=f"payout_{request.idempotency_key}",
            settlement_reference=request.settlement_reference,
            amount_cents=request.amount_cents,
            currency=request.currency,
        )

    async def get_payout_status(self, request: PayoutStatusRequest) -> PayoutStatusResult:
        status = PayoutStatus.PENDING
        return PayoutStatusResult(provider=self.name, status=status)

    async def parse_payout_webhook(self, envelope: WebhookEnvelope) -> PayoutWebhookEvent:
        return PayoutWebhookEvent(
            provider=self.name,
            provider_event_id="evt_1",
            status=PayoutStatus.COMPLETED,
            verified=True,
        )

    def capability(self) -> MarketplaceCapability:
        return MarketplaceCapability(
            name=self.name,
            display_name=self.display_name,
            supported_account_types=tuple(self.supported_account_types),
            configured=True,
            available=True,
        )

    def payout_webhook_path(self) -> str:
        return f"/webhooks/{self.name.value.lower()}/payouts"


@pytest.fixture
def provider() -> _FakeMarketplaceProvider:
    return _FakeMarketplaceProvider()


def test_activate_and_pay_a_seller_end_to_end(provider: _FakeMarketplaceProvider) -> None:
    onboarding = asyncio.run(
        provider.create_seller_onboarding(
            SellerOnboardingRequest(
                seller_id="seller-1",
                account_type=SellerPayoutAccountType.MPESA,
                business_name="Jane's Fashion",
                phone_number="0712345678",
            )
        )
    )
    assert onboarding.status is SellerPayoutAccountStatus.PENDING_VERIFICATION

    # Not yet payable — PENDING_VERIFICATION cannot receive a payout.
    with pytest.raises(ValidationError):
        asyncio.run(
            provider.create_payout(
                PayoutRequest(
                    provider_account_id=onboarding.provider_account_id,
                    amount_cents=10_000,
                    idempotency_key="payout-1",
                    settlement_reference="settlement-1",
                )
            )
        )

    provider._accounts[onboarding.provider_account_id] = SellerPayoutAccountStatus.ACTIVE
    result = asyncio.run(
        provider.create_payout(
            PayoutRequest(
                provider_account_id=onboarding.provider_account_id,
                amount_cents=10_000,
                idempotency_key="payout-1",
                settlement_reference="settlement-1",
            )
        )
    )
    assert result.status is PayoutStatus.PENDING
    assert result.provider_payout_id is not None


def test_create_payout_is_idempotent(provider: _FakeMarketplaceProvider) -> None:
    """The same idempotency_key must never submit a second transfer."""
    provider._accounts["acct-1"] = SellerPayoutAccountStatus.ACTIVE
    request = PayoutRequest(
        provider_account_id="acct-1",
        amount_cents=5_000,
        idempotency_key="payout-dup",
        settlement_reference="settlement-2",
    )
    first = asyncio.run(provider.create_payout(request))
    second = asyncio.run(provider.create_payout(request))
    assert first.provider_payout_id == second.provider_payout_id
    assert len(provider._payouts) == 1


def test_onboarding_refuses_an_unsupported_account_type(provider: _FakeMarketplaceProvider) -> None:
    with pytest.raises(ValidationError) as excinfo:
        asyncio.run(
            provider.create_seller_onboarding(
                SellerOnboardingRequest(
                    seller_id="seller-1",
                    account_type=SellerPayoutAccountType.BANK,  # not in supported_account_types
                    business_name="Jane's Fashion",
                )
            )
        )
    assert "BANK" in str(excinfo.value.details)


def test_capability_reports_supported_account_types(provider: _FakeMarketplaceProvider) -> None:
    capability = provider.capability()
    assert capability.available is True
    assert SellerPayoutAccountType.MPESA in capability.supported_account_types


def test_payout_webhook_path_is_provider_and_purpose_specific(provider: _FakeMarketplaceProvider) -> None:
    """Distinct from a hypothetical payment webhook path for the same
    provider — see the docstring on `payout_webhook_path` for why."""
    assert provider.payout_webhook_path() == "/webhooks/payhero/payouts"


# ─── Contract types ──────────────────────────────────────────────────────────


def test_payout_status_terminal_states() -> None:
    assert PayoutStatus.COMPLETED.is_terminal
    assert PayoutStatus.FAILED.is_terminal
    assert PayoutStatus.CANCELLED.is_terminal
    assert not PayoutStatus.PENDING.is_terminal
    assert not PayoutStatus.PROCESSING.is_terminal


def test_only_active_accounts_can_receive_payouts() -> None:
    assert SellerPayoutAccountStatus.ACTIVE.can_receive_payouts
    for status in (
        SellerPayoutAccountStatus.PENDING_VERIFICATION,
        SellerPayoutAccountStatus.VERIFIED,
        SellerPayoutAccountStatus.SUSPENDED,
        SellerPayoutAccountStatus.REJECTED,
    ):
        assert not status.can_receive_payouts


def test_payout_request_requires_a_positive_amount() -> None:
    with pytest.raises(PydanticValidationError):
        PayoutRequest(
            provider_account_id="acct-1",
            amount_cents=0,
            idempotency_key="k",
            settlement_reference="s",
        )


def test_payout_request_requires_an_idempotency_key() -> None:
    with pytest.raises(PydanticValidationError):
        PayoutRequest(
            provider_account_id="acct-1",
            amount_cents=100,
            settlement_reference="s",  # type: ignore[call-arg]
        )


def test_payout_request_rejects_unknown_fields() -> None:
    """Same provider-neutral discipline as `PaymentInitiationRequest` in
    `providers/payments/base.py` — a provider-specific field cannot sneak
    into the shared contract."""
    with pytest.raises(PydanticValidationError):
        PayoutRequest(
            provider_account_id="acct-1",
            amount_cents=100,
            idempotency_key="k",
            settlement_reference="s",
            paystack_subaccount_code="ACCT_xyz",  # type: ignore[call-arg]
        )


def test_seller_onboarding_result_safe_dump_redacts_provider_metadata() -> None:
    result = SellerOnboardingResult(
        provider=PaymentProviderName.PAYHERO,
        provider_account_id="acct-1",
        status=SellerPayoutAccountStatus.PENDING_VERIFICATION,
        account_type=SellerPayoutAccountType.MPESA,
        provider_metadata={"kyc_document_url": "https://example.com/secret"},
    )
    dumped = result.safe_dump()
    assert dumped["provider_metadata"] == "[REDACTED]"
    assert dumped["provider_account_id"] == "acct-1"  # non-sensitive fields survive
