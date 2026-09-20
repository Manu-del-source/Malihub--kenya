"""Payment endpoints.

╔══════════════════════════════════════════════════════════════════════════╗
║  Phase 8 exposes ONE route, and it is read-only.                         ║
║                                                                          ║
║  There is deliberately no POST /payments, no /payments/{id}/status, and   ║
║  no /payments/webhooks/{provider}. The only registered adapter is a stub,  ║
║  so every one of those would return 501 — a public, unauthenticated       ║
║  endpoint whose only behaviour is to fail is exactly the "fake production  ║
║  payment endpoint" Phase 8 exists to avoid. Worse, a webhook route would   ║
║  advertise to a provider (and to anyone scanning) that MaliHub accepts     ║
║  payment callbacks, when it cannot verify one.                           ║
║                                                                          ║
║  Phase 9 mounts them, in this order: the webhook route first (so a         ║
║  provider can be pointed at a verifiable URL), then initiation.           ║
╚══════════════════════════════════════════════════════════════════════════╝

What is here is genuinely useful today: `GET /payments/providers` is what a
checkout UI renders its options from, and it reports the truth — PayHero shows
`configured` from real environment values and `available: false` with the
reason, because being configured is not the same as being implemented.

Unauthenticated on purpose. The response contains no credentials, no account
identifiers and no internal URLs; it is the same information a pricing page
would carry. A buyer also needs it *before* they have necessarily signed in.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.providers.payments.base import PaymentProviderName
from app.providers.payments.registry import RESERVED_PROVIDERS
from app.schemas.payment import (
    PaymentProviderCapabilityResponse,
    PaymentProvidersResponse,
)
from app.services.payment_service import PaymentService, get_payment_service

router = APIRouter(prefix="/payments", tags=["payments"])


@router.get(
    "/providers",
    response_model=PaymentProvidersResponse,
    summary="List payment providers and whether they can be used",
    description=(
        "Provider-agnostic capability metadata. `available` is the field to "
        "render from: `configured` means credentials are present, `available` "
        "means a payment can actually be taken. In Phase 8 no provider is "
        "available — PayHero integration lands in Phase 9."
    ),
    responses={200: {"description": "The providers registered on this deployment."}},
)
async def list_payment_providers(
    service: PaymentService = Depends(get_payment_service),
) -> PaymentProvidersResponse:
    capabilities = service.capabilities()
    return PaymentProvidersResponse(
        default_provider=PaymentProviderName(service.default_provider_name.value),
        providers=[
            PaymentProviderCapabilityResponse.from_capability(capability) for capability in capabilities
        ],
        # Reserved providers are reported so an integrator can tell "you typed
        # it wrong" from "that's planned and not built". Reasons are static,
        # written for developers, and contain no configuration state.
        reserved=[{"provider": name.value, "reason": reason} for name, reason in RESERVED_PROVIDERS.items()],
    )


__all__ = ["router"]
