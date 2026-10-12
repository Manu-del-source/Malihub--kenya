"""SQLAlchemy mappings for the chat domain.

Mirrors `model Chat` from `prisma/schema.prisma`. Read the rule in
`models/base.py` first: **Prisma owns the DDL.** These classes describe a
table that already exists and never create or alter anything.

The mirror is deliberately partial — only the columns the realtime
authorization check needs: the two participant foreign keys. Everything the
`chats` table also carries (per-user archived/deleted state, the listing
link, `last_message_at`) is simply not selected. The authorization rule is
exactly one question — *is `user_id` the `buyer_id` or the `seller_id` of
this chat?* — and the mapping stays that small on purpose: every extra
column is one more thing to keep in sync with the schema for no behaviour.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Chat(Base):
    """`chats` — a buyer↔seller conversation about (at most) one listing."""

    __tablename__ = "chats"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        comment="Prisma declares `gen_random_uuid()` server-side; no application default here.",
    )
    buyer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        comment="Prisma field `buyerId`.",
    )
    seller_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        comment="Prisma field `sellerId`.",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        comment="Prisma `@default(now())`.",
    )
