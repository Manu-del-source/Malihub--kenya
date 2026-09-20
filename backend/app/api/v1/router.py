"""API v1 router — the aggregate of every versioned endpoint.

Versioning lives in the *path* (`/api/v1/…`), not in a header or a query
parameter, because:

* it is visible in a log line, a browser URL bar and a provider's callback
  configuration, which is where URLs actually get read;
* a breaking change becomes `app/api/v2/`, mounted alongside v1, so the two
  versions can run in the same process during a migration instead of requiring
  a coordinated deploy;
* the prefix is configuration (`API_V1_PREFIX`), so a deployment that needs to
  sit behind a gateway path can move it without editing routes.

Adding a resource in a later phase means: a module in `endpoints/`, a router in
it, and one `include_router` line below. Nothing else knows about it.

Breaking-change policy: a change that would make an existing client fail
(a renamed field, a removed enum value, a changed status code for the same
condition) belongs in v2. Adding a field, adding an endpoint, or adding an enum
value a client must already tolerate does not.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.v1.endpoints import health, payments
from app.core.config import Settings, get_settings
from app.schemas.common import ApiV1Index

api_router = APIRouter()

api_router.include_router(health.router)
api_router.include_router(payments.router)


@api_router.get(
    "",
    response_model=ApiV1Index,
    include_in_schema=False,
    summary="API v1 index",
)
async def v1_index(settings: Settings = Depends(get_settings)) -> ApiV1Index:
    """Discoverability for the versioned surface.

    Hidden from the OpenAPI schema (it documents itself) but not from clients:
    someone handed `https://api.malihub.co.ke/api/v1` should get a useful
    answer rather than a 404, and in production — where the schema is disabled
    — this is the only navigation the API offers.
    """
    prefix = settings.api_v1_prefix.rstrip("/")
    return ApiV1Index(
        api_version="v1",
        service=settings.app_name,
        version=settings.app_version,
        endpoints={
            "health": f"{prefix}/health",
            "readiness": f"{prefix}/health/ready",
            "payment_providers": f"{prefix}/payments/providers",
        },
    )


__all__ = ["api_router"]
