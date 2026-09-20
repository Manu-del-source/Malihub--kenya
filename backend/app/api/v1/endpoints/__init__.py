"""v1 endpoint modules. One module per resource, one `router` each."""

from __future__ import annotations

from app.api.v1.endpoints import health, payments

__all__ = ["health", "payments"]
