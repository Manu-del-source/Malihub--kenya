"""PaymentService — the only payment entry point the rest of the app uses.

    API route  ──▶  PaymentService  ──▶  PaymentProviderRegistry  ──▶  PayHeroProvider
                                                                      (DarajaProvider, later)

A route or a job never imports a provider. It calls this service, names a
provider (or accepts the configured default), and gets the interface back.
That is the whole reason adding Daraja later is a one-file change: everything
that would otherwise need updating is behind this seam.

╔══════════════════════════════════════════════════════════════════════════╗
║  Phase 8 scope: orchestration and delegation ONLY. No persistence.        ║
║  No route in this API creates, updates or settles a payment yet.          ║
╚══════════════════════════════════════════════════════════════════════════╝

The service currently does three things: resolve a provider, expose its
capabilities, and forward the four contract operations. Because the only
registered adapter is a stub, forwarding produces an honest 501 — which is the
correct Phase 8 behaviour, and the reason there is no `/payments/charge` route
pretending otherwise.

What Phase 9 adds *here*, and why it belongs in the service rather than in the
provider or the route:

 1. **Persistence around the provider call.** Create the `Payment` row
    (`status=PENDING`, `provider`, `method`, `amount_cents`, `currency`,
    `customer_reference`) and commit it *before* calling `initialize()`, then
    write back `provider_transaction_id` the moment it returns. Order matters:
    a provider callback can arrive before the HTTP response to our own request
    does, and if the row doesn't exist yet there is nothing to match it to.
 2. **Idempotency on the webhook path.** One `SETNX` on
    `provider_event_id`/`provider_transaction_id` (Redis, TTL'd) plus the
    unique index already on `payments.provider_transaction_id`, and a
    transition guard that refuses to move a row out of a terminal
    `PaymentStatus`. Providers retry; a retry must not double-settle,
    double-notify, or double-increment a seller's `total_sales`.
 3. **State fan-out on success.** `Order.status → PAID`, `Notification` rows
    for buyer and seller, and an email via `EmailService`. These are
    application concerns that a provider adapter must never know about.
 4. **The reconciliation sweep.** Find payments stuck in `PENDING`/`PROCESSING`
    past a timeout and call `check_status()` for each — the callback-never-
    arrives case. A scheduled job, not a route.
 5. **Verification on claim.** `verify_payment()` against the provider before
    any human-facing "this receipt is real" answer.
 6. **Audit.** Every state transition through `logAuditEvent` (see
    `src/services/audit-service.ts` for the existing vocabulary), with no
    payer PII in the metadata.

Every one of those is a service-layer responsibility, which is why this file —
not the adapters — is where Phase 9's real work happens.
"""

from __future__ import annotations

from typing import Any

from app.core.config import Settings, get_settings
from app.core.errors import NotFoundError
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
from app.providers.payments.registry import PaymentProviderRegistry, get_payment_registry

logger = get_logger(__name__)


class PaymentService:
    """Provider-agnostic payment orchestration.

    Constructed once at startup and injected as a FastAPI dependency
    (`api/deps.get_payment_service`). Stateless: it holds a registry reference
    and configuration, nothing per-request.
    """

    def __init__(
        self,
        registry: PaymentProviderRegistry | None = None,
        settings: Settings | None = None,
    ) -> None:
        self._registry = registry or get_payment_registry()
        self._settings = settings or get_settings()

    @property
    def registry(self) -> PaymentProviderRegistry:
        return self._registry

    # ─── Provider resolution ────────────────────────────────────────────────

    def provider(self, name: PaymentProviderName | str | None = None) -> PaymentProvider:
        """The adapter for `name`, or the configured default.

        `NotFoundError` (404) when the provider is unknown or reserved-but-
        unbuilt, with a body that says which — "we've never heard of that" and
        "that's planned work" need different responses from whoever asks.
        """
        return self._registry.resolve(name, settings=self._settings)

    @property
    def default_provider_name(self) -> PaymentProviderName:
        return PaymentProviderName(self._settings.payments_default_provider)

    def capabilities(self) -> list[ProviderCapability]:
        """Non-secret description of every registered provider.

        Backs `GET /api/v1/payments/providers`. Safe to serve unauthenticated:
        it contains no credentials, no account ids and no internal URLs, and a
        checkout UI needs it before the buyer is necessarily signed in.
        """
        return self._registry.capabilities()

    def find_provider_for_method(self, method: PaymentMethod) -> PaymentProvider | None:
        """First registered provider that supports `method`, or None.

        Used by a checkout UI that offers channels rather than processors
        ("Pay with M-Pesa"), which is how customers think about it. The
        configured default wins when it supports the method, so the choice is
        deterministic rather than registration-order-dependent.
        """
        default = self._registry.get(self.default_provider_name)
        if default is not None and default.supports(method):
            return default
        for provider in self._registry:
            if provider.supports(method):
                return provider
        return None

    # ─── Contract delegation ────────────────────────────────────────────────

    async def initiate_payment(
        self,
        request: PaymentInitiationRequest,
        *,
        provider_name: PaymentProviderName | str | None = None,
    ) -> PaymentInitiationResult:
        """Ask a provider to collect money.

        Phase 9 wraps this: create and commit the `Payment` row first, call
        this, then persist `provider_transaction_id`. See the module docstring.

        The amount is taken from `request`, which the *caller* must have derived
        from the Order in the database. Never from a client-supplied figure.
        """
        provider = self.provider(provider_name)
        provider.ensure_supports(request.method)
        logger.info(
            "payment_initiating",
            extra={
                "event": "payment_initiating",
                "provider": provider.name.value,
                "method": request.method.value,
                "amount_cents": request.amount_cents,
                "currency": request.currency,
                "customer_reference": request.customer_reference,
            },
        )
        result = await provider.initialize(request)
        logger.info(
            "payment_initiated",
            extra={
                "event": "payment_initiated",
                "provider": provider.name.value,
                "status": result.status.value,
                "has_provider_transaction_id": result.provider_transaction_id is not None,
                "customer_reference": request.customer_reference,
            },
        )
        return result

    async def get_payment_status(
        self,
        request: PaymentStatusRequest,
        *,
        provider_name: PaymentProviderName | str | None = None,
    ) -> PaymentStatusResult:
        """Pull a provider's current view of one transaction."""
        if not request.provider_transaction_id and not request.customer_reference:
            raise NotFoundError(
                "A provider_transaction_id or customer_reference is required to look up a payment."
            )
        provider = self.provider(provider_name)
        return await provider.check_status(request)

    async def process_webhook(
        self,
        provider_name: PaymentProviderName | str,
        envelope: WebhookEnvelope,
    ) -> WebhookEvent:
        """Verify and normalize an inbound provider callback.

        Phase 8 note: no route calls this yet, because mounting a public
        webhook endpoint whose only possible response is 501 would be exactly
        the fake production endpoint Phase 8 is meant to avoid. Phase 9 mounts
        `payments/webhooks/{provider}` and adds the idempotency guard plus the
        state fan-out around this call.

        Verification happens inside the adapter and is not optional — an
        unverified callback is a stranger POSTing "someone paid you".
        """
        provider = self.provider(provider_name)
        if envelope.provider != provider.name:
            # Defence in depth: the envelope's provider should have been set by
            # the router from the path. A mismatch means a routing bug, and
            # verifying a PayHero payload with Daraja's scheme would be worse
            # than not verifying it.
            logger.error(
                "payment_webhook_provider_mismatch",
                extra={
                    "event": "payment_webhook_provider_mismatch",
                    "path_provider": provider.name.value,
                    "envelope_provider": envelope.provider.value,
                },
            )
            raise NotFoundError("Webhook provider mismatch.")
        event = await provider.handle_webhook(envelope)
        logger.info(
            "payment_webhook_processed",
            extra={
                "event": "payment_webhook_processed",
                "provider": provider.name.value,
                "event_type": event.event_type.value,
                "verified": event.verified,
                "has_provider_event_id": event.provider_event_id is not None,
                # Deliberately absent: amount, payer reference, raw payload.
            },
        )
        return event

    async def verify_payment(
        self,
        provider_reference: str,
        *,
        provider_name: PaymentProviderName | str | None = None,
        expected_amount_cents: int | None = None,
        expected_currency: str | None = None,
    ) -> PaymentVerificationResult:
        """Confirm a claimed settlement is real, and that it matches.

        `expected_*` come from the `Payment` row, never from the claim being
        verified — the entire value of this operation is that it compares a
        customer- or agent-supplied reference against both the provider and our
        own record.
        """
        provider = self.provider(provider_name)
        result = await provider.verify_payment(provider_reference=provider_reference)

        if (
            result.verified
            and expected_amount_cents is not None
            and result.amount_cents != expected_amount_cents
        ):
            # The check that makes verification worth calling: a provider
            # reference that resolves to a *different amount* than our order
            # is either a forged claim or a provider-side bug, and either way
            # it must not settle.
            logger.warning(
                "payment_verification_amount_mismatch",
                extra={
                    "event": "payment_verification_amount_mismatch",
                    "provider": provider.name.value,
                    "expected_amount_cents": expected_amount_cents,
                    "reported_amount_cents": result.amount_cents,
                },
            )
            return result.model_copy(
                update={
                    "verified": False,
                    "reason": "The amount reported by the provider does not match this order.",
                }
            )
        if (
            result.verified
            and expected_currency
            and result.currency
            and result.currency.upper() != expected_currency.upper()
        ):
            return result.model_copy(
                update={
                    "verified": False,
                    "reason": "The currency reported by the provider does not match this order.",
                }
            )
        return result

    async def refund(
        self,
        request: RefundRequest,
        *,
        provider_name: PaymentProviderName | str | None = None,
    ) -> RefundResult:
        provider = self.provider(provider_name)
        return await provider.refund(request)

    # ─── Diagnostics ────────────────────────────────────────────────────────

    def describe(self) -> dict[str, Any]:
        """Non-secret summary for logs and the health payload."""
        return {
            "default_provider": self.default_provider_name.value,
            "registered": [name.value for name in self._registry.registered],
            "capabilities": [capability.safe_dump() for capability in self.capabilities()],
        }


_service: PaymentService | None = None


def get_payment_service() -> PaymentService:
    """Process-wide singleton, and the FastAPI dependency for payment routes."""
    global _service
    if _service is None:
        _service = PaymentService()
    return _service


def reset_payment_service() -> None:
    """Drop the singleton. For tests that change settings between cases."""
    global _service
    _service = None


__all__ = ["PaymentService", "get_payment_service", "reset_payment_service"]
