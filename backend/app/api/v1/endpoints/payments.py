"""Payment endpoints.

╔══════════════════════════════════════════════════════════════════════════╗
║  This API exposes ONE route, and it is read-only.                         ║
║                                                                          ║
║  There is deliberately no POST /payments, no /payments/{id}/status, and   ║
║  no /payments/webhooks/{provider}. This service registers no collection   ║
║  adapters and holds no payment-provider credentials — a public,           ║
║  unauthenticated endpoint whose only behaviour would be to fail is exactly ║
║  the "fake production payment endpoint" this API refuses to be, and a     ║
║  webhook route would advertise a callback surface that cannot verify one. ║
║                                                                          ║
║  Buyer payment collection (Paystack hosted checkout, the signed          ║
║  charge.success webhook, verification) lives in the NEXT.JS application   ║
║  at /api/payments/paystack/* — that is where the PAYSTACK_SECRET_KEY      ║
║  lives and where a verifiable webhook URL exists.                        ║
╚══════════════════════════════════════════════════════════════════════════╝

What is here is genuinely useful: `GET /payments/providers` reports the truth
— which provider names exist in the schema, which are registered on this
deployment (none, today), and why each unregistered name answers 404.

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
        "Provider-agnostic capability metadata. `providers` lists the "
        "adapters registered on this deployment (none today — Paystack "
        "collection lives in the Next.js application), and `reserved` lists "
        "schema values with the reason each answers 404 here."
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
