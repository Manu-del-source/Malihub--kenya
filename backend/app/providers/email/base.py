"""Email provider contract.

    EmailService  (app/services/email_service.py)
          │
          ▼
    EmailProvider  ← this module
          │
          └── ResendEmailProvider  (providers/email/resend.py)

Resend is MaliHub's email provider. It is already used by the Next.js app
(`src/services/email-service.ts`, with React Email templates in `src/emails/`);
this is the backend's side of the same arrangement, for the mail a Python
service has to send — payment confirmations, provider failure alerts, anything
triggered by a webhook rather than by a browser.

The two sides are not unified, and that is intentional rather than an
oversight: the frontend renders React components to HTML with `@react-email/components`,
which has no Python equivalent worth the dependency. Templates therefore stay
with the runtime that renders them, and what is shared is the *contract* — the
same message shape, the same provider, the same "degrade, don't crash"
behaviour when `RESEND_API_KEY` is absent.

Design rule this abstraction exists to enforce: **email is an enhancement on
top of in-app notifications, never the only channel.** A failed send must not
fail the operation that triggered it. `EmailService` upholds that; providers
just report what happened.

Template scope for Phase 8: one generic notification template, as a reference
implementation. The named slots below (`EmailTemplateKind`) document what will
exist; building all of them now would be inventing copy for flows that are not
built yet.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from enum import Enum, StrEnum
from typing import Any, ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class EmailTemplateKind(StrEnum):
    """The transactional emails MaliHub will send.

    Documented as an enum now so the vocabulary is fixed and reviewable, even
    though only `GENERIC_NOTIFICATION` has a renderer. Adding a template in a
    later phase means adding a renderer, not deciding a name.

    These mirror the `NotificationType` enum in prisma/schema.prisma where they
    overlap — an email and an in-app notification about the same event should
    not have unrelated names.
    """

    # Implemented
    GENERIC_NOTIFICATION = "generic_notification"
    # Planned — no renderer yet, deliberately. Copy for these flows belongs
    # with the flows, which do not exist yet.
    EMAIL_VERIFICATION = "email_verification"
    # Both `noqa: S105` are deliberate. A secret scanner sees "password" next
    # to a string literal and assumes a credential; these are template
    # identifiers, and renaming them to dodge the rule would make the
    # vocabulary wrong rather than safer.
    PASSWORD_RESET = "password_reset"  # noqa: S105
    PASSWORD_CHANGED = "password_changed"  # noqa: S105
    ORDER_CONFIRMATION = "order_confirmation"
    ORDER_STATUS_UPDATE = "order_status_update"
    PAYMENT_RECEIVED = "payment_received"
    PAYMENT_FAILED = "payment_failed"
    PAYOUT_SUMMARY = "payout_summary"
    LISTING_APPROVED = "listing_approved"
    LISTING_REJECTED = "listing_rejected"
    NEW_MESSAGE = "new_message"
    WISHLIST_ALERT = "wishlist_alert"


class EmailMessage(BaseModel):
    """One outbound email.

    Exactly one of `html`, `text`, or `template` must carry the body — enforced
    in `_require_body`, because an email with no body is accepted by most
    providers and delivered as blank, which is a silent failure.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    to: list[str] = Field(min_length=1, max_length=50)
    subject: str = Field(min_length=1, max_length=200)
    html: str | None = None
    text: str | None = None
    #: Overrides `EMAIL_FROM`. Rarely wanted: sending from an unverified
    #: domain is rejected by Resend, and a per-message From is how that mistake
    #: gets made.
    from_address: str | None = None
    reply_to: str | None = None
    cc: list[str] = Field(default_factory=list, max_length=10)
    bcc: list[str] = Field(default_factory=list, max_length=10)
    #: Provider-side label, for filtering and for the send-log. Must not carry
    #: user data — Resend tags are visible in its dashboard.
    tags: list[dict[str, str]] = Field(default_factory=list, max_length=10)
    template: EmailTemplateKind | None = None
    template_context: dict[str, Any] = Field(default_factory=dict)

    @field_validator("to", "cc", "bcc", mode="before")
    @classmethod
    def _coerce_recipients(cls, value: Any) -> Any:
        """Accept a bare string where a list is declared.

        `send_email(to="a@b.c")` reads naturally at a call site and failing it
        with a validation error buys nothing.
        """
        if isinstance(value, str):
            return [value]
        return value

    @field_validator("to", "cc", "bcc")
    @classmethod
    def _normalize_recipients(cls, addresses: list[str]) -> list[str]:
        cleaned = [address.strip().lower() for address in addresses if address and address.strip()]
        # De-duplicate while preserving order: a double-notify from two code
        # paths should not produce two identical emails.
        seen: set[str] = set()
        unique = []
        for address in cleaned:
            if address not in seen:
                seen.add(address)
                unique.append(address)
        return unique

    @field_validator("subject")
    @classmethod
    def _strip_newlines(cls, value: str) -> str:
        # A subject containing CR/LF is a header-injection attempt against
        # whatever assembles the MIME message downstream.
        return " ".join(value.split())

    def _require_body(self) -> EmailMessage:
        if not (self.html or self.text or self.template):
            raise ValueError("An EmailMessage needs html, text, or a template.")
        return self

    def model_post_init(self, __context: Any) -> None:
        self._require_body()


class EmailSendResult(BaseModel):
    """What happened. Never an exception for an expected failure."""

    model_config = ConfigDict(extra="forbid")

    sent: bool
    provider: str
    provider_message_id: str | None = None
    #: Present when `sent` is False. Safe to surface in an admin UI; the
    #: provider's raw error is not (it can echo the API key in a URL).
    error: str | None = None
    #: True when nothing was attempted because the provider isn't configured.
    #: Distinct from `sent=False`: one is a delivery failure worth alerting on,
    #: the other is a known-disabled environment.
    skipped: bool = False
    status_code: int | None = None


DeliveryPriority = Literal["critical", "normal", "low"]


class EmailProvider(ABC):
    """One email delivery service."""

    name: ClassVar[str]
    display_name: ClassVar[str] = ""

    @abstractmethod
    async def send(self, message: EmailMessage) -> EmailSendResult:
        """Deliver one email.

        Must not raise for a delivery failure — return `sent=False` with an
        `error`. Raising would make "the confirmation email failed" take down
        "the payment was recorded", and those two must never be coupled.

        Must not log recipient addresses in full or message bodies at all.
        Bodies routinely contain order details, amounts and links with tokens.
        """

    @property
    @abstractmethod
    def is_configured(self) -> bool:
        """False means every send is skipped, not queued and not retried."""

    async def healthcheck(self) -> tuple[bool, float | None]:
        """Configuration-only by default. Email is not on the readiness path."""
        return self.is_configured, None


__all__ = [
    "DeliveryPriority",
    "EmailMessage",
    "EmailProvider",
    "EmailSendResult",
    "EmailTemplateKind",
]
