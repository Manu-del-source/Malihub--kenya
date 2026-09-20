"""Database mappings. Prisma owns the DDL — see `models/base.py`."""

from __future__ import annotations

from app.models.base import Base
from app.models.payment import Order, Payment

__all__ = ["Base", "Order", "Payment"]
