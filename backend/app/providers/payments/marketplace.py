"""The marketplace provider contract — seller onboarding and payouts.

    SettlementService  (app/services/settlement_service.py, not yet built)
          │
          ▼
    MarketplaceProvider  ← this module
          │
          └── (no adapter registered yet — see the Phase 9 provider-comparison
              doc: no Kenyan provider's marketplace/payout capability has been
              confirmed against a sandbox yet, so nothing here is implemented
              against a real API. Writing an adapter that "mostly works" from
              documentation alone is exactly the invented-capability failure
              mode the brief warns against.)

This is deliberately a SEPARATE contract from `PaymentProvider` in `base.py`,
not an extension of it. A processor that can collect a buyer's M-Pesa payment
(`PaymentProvider`) is not automatically one that can onboard a seller as a
payee and pay them out (`MarketplaceProvider`) — PayHero is the proof: it
implements payment collection but has no sub-merchant/payee concept at all
(see `docs/payments/provider-comparison.md`). A single class (e.g. Paystack)
may implement both contracts; PayHero implements only the first; a future
provider could plausibly implement only the second (a payouts-only rail
layered on top of PayHero for collection). Forcing every `PaymentProvider` to
also carry marketplace methods would mean every adapter — including PayHero's
already-shipped one — grows abstract methods it cannot honestly implement.

Five operations, matching the seller-payout-account lifecycle in
`prisma/schema.prisma` (`SellerPayoutAccount`, `Payout`):

* `create_seller_onboarding`  — start the provider's self-service KYC/connect
                                  flow for a seller; MaliHub never collects
                                  the sensitive KYC/banking detail itself.
* `get_seller_account`         — poll the provider's current verification
                                  state for an already-started onboarding.
* `create_payout`              — instruct the provider to pay a verified
                                  seller account.
* `get_payout_status`          — pull (poll) the provider's current view of
                                  one payout.
* `parse_payout_webhook`       — verify and parse a payout-status callback.
                                  Separate from `PaymentProvider.handle_webhook`
                                  because a payout callback and a collection
                                  callback are different events, on different
                                  provider endpoints, verified against
                                  (possibly) different secrets.

Same non-negotiables as `PaymentProvider`: stateless adapters, idempotent
`create_payout` (a caller-supplied `idempotency_key`, always), no secrets in
logs or `safe_dump()`, and every failure raised as one of the typed errors in
`app.core.errors` — never a bare `Exception`.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
from enum import StrEnum
from typing import Any, ClassVar

from pydantic import BaseModel, ConfigDict, Field

from app.core.errors import PaymentProviderError, ValidationError, WebhookVerificationError
from app.providers.payments.base import PaymentProviderName, WebhookEnvelope

# ─── Provider-neutral vocabulary ─────────────────────────────────────────────
# Mirrors the Prisma enums character-for-character, same rule as base.py.


class SellerPayoutAccountType(StrEnum):
    MPESA = "MPESA"
    BANK = "BANK"


class SellerPayoutAccountStatus(StrEnum):
    PENDING_VERIFICATION = "PENDING_VERIFICATION"
    VERIFIED = "VERIFIED"
    ACTIVE = "ACTIVE"
    SUSPENDED = "SUSPENDED"
    REJECTED = "REJECTED"

    @property
    def can_receive_payouts(self) -> bool:
        """Only an ACTIVE account may be the target of `create_payout`.

        VERIFIED is deliberately excluded: it means the provider has
        confirmed the account's identity, not that MaliHub has finished
        whatever activation step (e.g. a first-payout confirmation) turns a
        verified account into a live payout destination. Collapsing the two
        is how a payout gets attempted against an account that looks fine but
        isn't actually wired up yet.
        """
        return self is SellerPayoutAccountStatus.ACTIVE


class PayoutStatus(StrEnum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"

    @property
    def is_terminal(self) -> bool:
        return self in _TERMINAL_PAYOUT_STATUSES


_TERMINAL_PAYOUT_STATUSES = frozenset({PayoutStatus.COMPLETED, PayoutStatus.FAILED, PayoutStatus.CANCELLED})


# ─── Contracts ───────────────────────────────────────────────────────────────

#: Same intent as `base.py`'s `_SENSITIVE_FIELDS`, kept as a separate copy
#: rather than a shared import — the two contracts' sensitive-field sets are
#: allowed to diverge (a seller's bank detail is not a buyer's phone number),
#: and duplicating four names is cheaper than coupling two modules over a
#: private symbol.
_SENSITIVE_FIELDS = frozenset(
    {"raw", "raw_body", "signature", "provider_metadata", "bank_account_number", "phone_number"}
)


def _strip_sensitive(data: Any) -> Any:
    if isinstance(data, dict):
        return {
            key: ("[REDACTED]" if key in _SENSITIVE_FIELDS else _strip_sensitive(value))
            for key, value in data.items()
        }
    if isinstance(data, list):
        return [_strip_sensitive(item) for item in data]
    return data


class _MarketplaceModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        use_enum_values=False,
        validate_assignment=True,
        str_strip_whitespace=True,
    )

    def safe_dump(self, **kwargs: Any) -> dict[str, Any]:
        return _strip_sensitive(self.model_dump(mode="json", **kwargs))


class SellerOnboardingRequest(_MarketplaceModel):
    """What MaliHub knows about a seller before handing off to the provider's
    own KYC surface. Deliberately thin: MaliHub collects the minimum needed
    to start the provider's flow, then the provider — not this backend —
    collects the sensitive KYC/banking detail directly from the seller.
    """

    seller_id: str
    account_type: SellerPayoutAccountType
    business_name: str
    #: Normalized Kenyan MSISDN, when `account_type` is MPESA. Reuses the
    #: same normalization `Payer.phone_number` applies in `base.py` — a
    #: seller's payout number goes through the identical `07.../+254...`
    #: cleanup as a buyer's payment number.
    phone_number: str | None = None
    #: Set only when `account_type` is BANK, and only if the provider's
    #: onboarding flow needs it passed in rather than collected by the
    #: provider directly. Prefer leaving this unset and letting the
    #: provider's own hosted onboarding collect it — the point of "the
    #: provider owns sensitive financial onboarding" (Phase 9 brief §6) is
    #: that this backend has as little reason to touch it as possible.
    bank_account_number: str | None = None
    bank_code: str | None = None
    email: str | None = None
    #: MaliHub's own callback used once the provider's onboarding flow
    #: completes (e.g. a hosted KYC redirect). Never accepted from a client
    #: request — built server-side from configuration, same rule as
    #: `PayHeroProvider`'s `callback_url` in the Phase 9 checklist.
    return_url: str | None = None


class SellerOnboardingResult(_MarketplaceModel):
    provider: PaymentProviderName
    #: The provider's identifier for this payee. Never a secret.
    provider_account_id: str
    status: SellerPayoutAccountStatus
    account_type: SellerPayoutAccountType
    #: A hosted onboarding/KYC URL to redirect the seller to, when the
    #: provider's flow is redirect-based rather than API-only. None when the
    #: provider completed onboarding synchronously from the request alone.
    onboarding_url: str | None = None
    provider_metadata: dict[str, Any] | None = None
    raw: dict[str, Any] | None = None


class SellerAccountStatusRequest(_MarketplaceModel):
    provider_account_id: str


class SellerAccountStatusResult(_MarketplaceModel):
    provider: PaymentProviderName
    provider_account_id: str
    status: SellerPayoutAccountStatus
    account_type: SellerPayoutAccountType
    #: Non-secret, human-readable detail on *why* a status is what it is
    #: (e.g. "awaiting ID document"). Shown to the seller in their dashboard;
    #: never a raw provider payload.
    status_reason: str | None = None
    raw: dict[str, Any] | None = None


class PayoutRequest(_MarketplaceModel):
    """Instruction to pay a verified seller account.

    `idempotency_key` is required, not optional, unlike `RefundRequest`'s
    equivalent field in `base.py` — a refund is initiated by a human clicking
    a button once; a payout can plausibly be re-submitted by a retrying job,
    and money moving to the wrong seller's account twice is a worse failure
    mode than a refund double-submission caught by a human reviewing a
    dashboard.
    """

    provider_account_id: str
    amount_cents: int = Field(gt=0)
    currency: str = "KES"
    idempotency_key: str
    #: MaliHub's own settlement id, echoed to the provider as the payout's
    #: external reference where the provider supports one — same reasoning
    #: as `PaymentInitiationRequest.customer_reference` in `base.py`: a
    #: payout webhook needs a join key that exists before the provider
    #: assigns its own transaction id.
    settlement_reference: str
    narrative: str | None = Field(default=None, max_length=200)


class PayoutResult(_MarketplaceModel):
    provider: PaymentProviderName
    status: PayoutStatus
    #: Null until the provider acknowledges the request. Never treat a
    #: non-null value here as proof of a completed transfer — see the
    #: `PayoutStatus` docstring and `Payout.completedAt`'s comment in the
    #: Prisma schema: only a verified webhook or status poll may set that.
    provider_payout_id: str | None = None
    settlement_reference: str
    amount_cents: int | None = None
    currency: str | None = None
    failure_code: str | None = None
    failure_reason: str | None = None
    raw: dict[str, Any] | None = None


class PayoutStatusRequest(_MarketplaceModel):
    provider_payout_id: str | None = None
    settlement_reference: str | None = None


class PayoutStatusResult(_MarketplaceModel):
    provider: PaymentProviderName
    status: PayoutStatus
    provider_payout_id: str | None = None
    completed_at: datetime | None = None
    failure_code: str | None = None
    failure_reason: str | None = None
    raw: dict[str, Any] | None = None


class PayoutWebhookEvent(_MarketplaceModel):
    provider: PaymentProviderName
    provider_event_id: str
    provider_payout_id: str | None = None
    settlement_reference: str | None = None
    status: PayoutStatus
    verified: bool
    raw: dict[str, Any] | None = None


class MarketplaceCapability(_MarketplaceModel):
    """Non-secret self-description, the marketplace-side sibling of
    `ProviderCapability` in `base.py`. Backs whatever endpoint the seller
    onboarding UI reads its available payout rails from — not built yet;
    see `docs/payments/provider-comparison.md` for why no provider is
    `available=True` here today.
    """

    name: PaymentProviderName
    display_name: str
    supported_account_types: tuple[SellerPayoutAccountType, ...] = ()
    configured: bool = False
    available: bool = False
    unavailable_reason: str | None = None
    sandbox: bool = False


# ─── The interface ───────────────────────────────────────────────────────────


class MarketplaceProvider(ABC):
    """One processor's seller-onboarding and payout surface.

    Implementations must be:

    * **Stateless**, constructed once at startup, same as `PaymentProvider`.
    * **Idempotency-aware.** `create_payout` must be safe to receive the same
      `idempotency_key` twice — return the original result, never submit a
      second transfer.
    * **Silent about secrets.** Never log a credential, a raw payload, or a
      seller's bank/M-Pesa detail beyond what `safe_dump()` already permits.
    * **Honest about failure**, using the same error vocabulary as
      `PaymentProvider`: `PaymentProviderError` for provider/network trouble,
      `WebhookVerificationError` for a callback that fails verification,
      `NotImplementedFeatureError` for not-yet-built.
    """

    name: ClassVar[PaymentProviderName]
    display_name: ClassVar[str] = ""
    supported_account_types: ClassVar[frozenset[SellerPayoutAccountType]] = frozenset()
    sandbox: ClassVar[bool] = False

    @abstractmethod
    async def create_seller_onboarding(self, request: SellerOnboardingRequest) -> SellerOnboardingResult:
        """Start the provider's onboarding/KYC flow for one seller.

        Must not collect or forward a password, PIN, or full banking
        credential — only what `SellerOnboardingRequest` already carries, or
        a redirect to the provider's own hosted flow.
        """

    @abstractmethod
    async def get_seller_account(self, request: SellerAccountStatusRequest) -> SellerAccountStatusResult:
        """Poll the provider's current verification state for one seller."""

    @abstractmethod
    async def create_payout(self, request: PayoutRequest) -> PayoutResult:
        """Instruct the provider to pay a verified seller account.

        Contract for implementations:
          * Refuse (raise `ValidationError`) if the target account's last
            known status is not `ACTIVE` — a caller should have checked this
            already; the adapter checks again because trusting the caller on
            money is exactly what `PaymentProvider.initialize` also refuses
            to do for amounts.
          * Pass `idempotency_key` through to the provider's own idempotency
            mechanism where one exists; otherwise the caller (the settlement
            service) is responsible for a `SETNX`-style guard before calling
            this at all — never invent idempotency the provider can't back.
          * Return `status=PENDING` or `PROCESSING` for any asynchronous
            payout rail. Returning `COMPLETED` here would mean the adapter is
            claiming money has moved on the strength of a submission
            response, which is the exact mistake §12 of the Phase 9 brief
            calls out.
        """

    @abstractmethod
    async def get_payout_status(self, request: PayoutStatusRequest) -> PayoutStatusResult:
        """Pull the provider's current state for one payout — the
        reconciliation path for a payout stuck in PENDING/PROCESSING past a
        timeout, mirroring `PaymentProvider.check_status`."""

    @abstractmethod
    async def parse_payout_webhook(self, envelope: WebhookEnvelope) -> PayoutWebhookEvent:
        """Verify, then parse, a payout-status callback.

        Verification is not optional, for the same reason as
        `PaymentProvider.handle_webhook`: this is a public, unauthenticated
        endpoint, so an unverified callback is a stranger claiming a payout
        completed. Raise `WebhookVerificationError` on any doubt.
        """

    @abstractmethod
    def capability(self) -> MarketplaceCapability:
        """Non-secret self-description for a seller-onboarding UI."""

    @abstractmethod
    def payout_webhook_path(self) -> str:
        """Relative path this provider's payout callbacks arrive on.

        Deliberately a different path from `PaymentProvider.webhook_path()`
        even for a provider that implements both contracts — a payout
        callback and a payment callback are different events with (possibly)
        different signing secrets, and routing them to the same handler
        would have to disambiguate an unverified payload before it could be
        verified.
        """

    # ─── Shared helpers ─────────────────────────────────────────────────────

    def supports(self, account_type: SellerPayoutAccountType) -> bool:
        return account_type in self.supported_account_types

    def ensure_supports(self, account_type: SellerPayoutAccountType) -> None:
        if not self.supports(account_type):
            raise ValidationError(
                f"{self.display_name or self.name.value} does not support payouts to {account_type.value}.",
                details={
                    "account_type": account_type.value,
                    "supported": sorted(candidate.value for candidate in self.supported_account_types),
                },
            )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<{type(self).__name__} {self.name.value} sandbox={self.sandbox}>"


__all__ = [
    "MarketplaceCapability",
    "MarketplaceProvider",
    "PaymentProviderError",
    "PayoutRequest",
    "PayoutResult",
    "PayoutStatus",
    "PayoutStatusRequest",
    "PayoutStatusResult",
    "PayoutWebhookEvent",
    "SellerAccountStatusRequest",
    "SellerAccountStatusResult",
    "SellerOnboardingRequest",
    "SellerOnboardingResult",
    "SellerPayoutAccountStatus",
    "SellerPayoutAccountType",
    "ValidationError",
    "WebhookVerificationError",
]
