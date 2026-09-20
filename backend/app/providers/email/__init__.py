"""Email provider adapters. Resend is the configured provider."""

from __future__ import annotations

from app.providers.email.base import (
    DeliveryPriority,
    EmailMessage,
    EmailProvider,
    EmailSendResult,
    EmailTemplateKind,
)
from app.providers.email.resend import ResendEmailProvider

__all__ = [
    "DeliveryPriority",
    "EmailMessage",
    "EmailProvider",
    "EmailSendResult",
    "EmailTemplateKind",
    "ResendEmailProvider",
]
