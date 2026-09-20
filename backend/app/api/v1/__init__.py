"""API version 1. Mounted at `API_V1_PREFIX` (default `/api/v1`)."""

from __future__ import annotations

from app.api.v1.router import api_router

__all__ = ["api_router"]
