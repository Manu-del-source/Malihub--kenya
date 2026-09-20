"""Application services — the layer between routes and providers/data.

A route validates input, calls a service, and shapes the response. Everything
with a decision in it lives here: which provider to use, what to persist, when
to notify. Providers (`app/providers/`) only know how to talk to one vendor;
services know what MaliHub is trying to do.

Phase 8 ships these as orchestration seams with no business logic behind them
yet — that is Phase 9. Each module documents precisely what gets added to it.
"""

from __future__ import annotations

from app.services.email_service import EmailService, get_email_service
from app.services.payment_service import PaymentService, get_payment_service
from app.services.rate_limit import RateLimiter, get_rate_limiter
from app.services.storage_service import StorageService, get_storage_service

__all__ = [
    "EmailService",
    "PaymentService",
    "RateLimiter",
    "StorageService",
    "get_email_service",
    "get_payment_service",
    "get_rate_limiter",
    "get_storage_service",
]
