"""Resend email adapter.

Unlike the PayHero and Cloudinary transfer stubs, this one is real: Resend is
already MaliHub's email provider on the Next.js side, its API is a single POST,
and it is inert without `RESEND_API_KEY`. Implementing it costs ~40 lines and
means the backend can send a confirmation email the moment something needs to,
instead of that being blocked behind a phase.

Behaviour with no API key configured: every send is **skipped**, logged once at
WARNING, and returned as `skipped=True`. This deliberately matches
`src/services/email-service.ts`, which no-ops the same way, so local
development without a Resend account doesn't break flows that merely happen to
notify someone. It is not a queue and not a retry — a skipped email is gone.

Security notes specific to this file:
  * The API key is read from a `SecretStr` and placed in a header built at call
    time. It is never stored on the instance, never interpolated into a URL
    (Resend's error responses have been known to echo request details), and
    never logged — `core.logging` redacts by key name as a backstop only.
  * The provider's raw error body is not surfaced to callers. It can contain
    account identifiers and, on a 401, the shape of the rejected credential.
    `EmailSendResult.error` carries a short, safe classification instead; the
    detail goes to the log.
  * Recipient addresses are logged through the `email` key, which
    `core.logging` masks.
"""

from __future__ import annotations

from typing import Any

import httpx

from app.core.config import Settings, get_settings
from app.core.logging import get_logger
from app.providers.email.base import EmailMessage, EmailProvider, EmailSendResult

logger = get_logger(__name__)

#: Short, safe failure classifications. Deliberately coarse — the caller needs
#: to know "retry / don't retry / not configured", not Resend's internals.
ERROR_UNCONFIGURED = "email_provider_not_configured"
ERROR_NO_BODY = "message_has_no_rendered_body"
ERROR_REJECTED = "provider_rejected_message"
ERROR_UNAUTHORIZED = "provider_credentials_rejected"
ERROR_RATE_LIMITED = "provider_rate_limited"
ERROR_UPSTREAM = "provider_unavailable"
ERROR_TIMEOUT = "provider_timeout"


class ResendEmailProvider(EmailProvider):
    """Deliver email through Resend's `/emails` API."""

    name = "resend"
    display_name = "Resend"

    def __init__(self, settings: Settings | None = None, *, client: httpx.AsyncClient | None = None) -> None:
        self._settings = settings or get_settings()
        # Injectable for tests; in production one client is created at startup
        # and shared, so TLS sessions and the connection pool are reused.
        self._client = client
        self._owns_client = client is None
        self._unconfigured_logged = False

    @property
    def is_configured(self) -> bool:
        return bool(self._settings.resend_api_key)

    @property
    def _base_url(self) -> str:
        return self._settings.resend_base_url

    async def send(self, message: EmailMessage) -> EmailSendResult:
        if not self.is_configured:
            if not self._unconfigured_logged:
                logger.warning(
                    "email_provider_unconfigured",
                    extra={
                        "event": "email_provider_unconfigured",
                        "provider": self.name,
                        "detail": "RESEND_API_KEY is not set; email delivery is disabled.",
                    },
                )
                self._unconfigured_logged = True
            return EmailSendResult(
                sent=False,
                provider=self.name,
                skipped=True,
                error=ERROR_UNCONFIGURED,
            )

        payload = self._build_payload(message)
        if payload is None:
            logger.warning(
                "email_no_body",
                extra={
                    "event": "email_no_body",
                    "provider": self.name,
                    "template": message.template.value if message.template else None,
                },
            )
            return EmailSendResult(sent=False, provider=self.name, error=ERROR_NO_BODY)

        headers = self._headers()
        if headers is None:
            # The key went missing between the `is_configured` check above and
            # here — settings are swapped under test and on reload. Same
            # outcome as being unconfigured from the start.
            return EmailSendResult(sent=False, provider=self.name, skipped=True, error=ERROR_UNCONFIGURED)

        client = await self._get_client()
        try:
            response = await client.post(
                f"{self._base_url.rstrip('/')}/emails",
                json=payload,
                headers=headers,
                timeout=self._settings.email_timeout_seconds,
            )
        except httpx.TimeoutException:
            return self._failure(message, ERROR_TIMEOUT, "timeout", None)
        except httpx.HTTPError as exc:
            # Transport-level failure (DNS, TLS, connection reset). Type only:
            # httpx exception text can include the request URL and headers.
            return self._failure(message, ERROR_UPSTREAM, type(exc).__name__, None)

        if response.status_code in (200, 201):
            data = _safe_json(response)
            message_id = data.get("id") if isinstance(data, dict) else None
            logger.info(
                "email_sent",
                extra={
                    "event": "email_sent",
                    "provider": self.name,
                    "recipient_count": len(message.to),
                    "email": message.to[0] if message.to else None,
                    "template": message.template.value if message.template else None,
                    "provider_message_id": message_id,
                },
            )
            return EmailSendResult(
                sent=True,
                provider=self.name,
                provider_message_id=message_id if isinstance(message_id, str) else None,
                status_code=response.status_code,
            )

        classification = _classify_status(response.status_code)
        return self._failure(message, classification, None, response.status_code, response_body=response.text)

    # ─── Internals ──────────────────────────────────────────────────────────

    def _headers(self) -> dict[str, str] | None:
        """Auth headers, or `None` if the key is not configured.

        Returns `None` rather than raising, and rather than asserting: an
        assert disappears under `python -O` (a flag production images set)
        leaving `None.get_secret_value()` to raise AttributeError, and any
        exception here would propagate out of `send()` — which must never
        happen, because a failed notification should not take down the request
        that triggered it.
        """
        api_key = self._settings.resend_api_key
        if api_key is None:
            return None
        return {
            "Authorization": f"Bearer {api_key.get_secret_value()}",
            "Content-Type": "application/json",
            # Resend supports an idempotency key; none is generated here because
            # a retry decision belongs to the caller, which knows whether the
            # email is a once-ever notification or a periodic digest.
        }

    def _build_payload(self, message: EmailMessage) -> dict[str, Any] | None:
        """Map our message onto Resend's request body. None if there's no body."""
        if not message.html and not message.text:
            # `template` without html means the service layer didn't render —
            # a caller bug, reported rather than guessed at here.
            return None

        settings = self._settings
        payload: dict[str, Any] = {
            "from": message.from_address or settings.email_from,
            "to": message.to,
            "subject": message.subject,
        }
        if message.html:
            payload["html"] = message.html
        if message.text:
            payload["text"] = message.text
        if message.reply_to:
            payload["reply_to"] = message.reply_to
        elif settings.email_reply_to:
            payload["reply_to"] = settings.email_reply_to
        if message.cc:
            payload["cc"] = message.cc
        if message.bcc:
            payload["bcc"] = message.bcc
        tags = _normalize_tags(message.tags)
        if tags:
            payload["tags"] = tags
        return payload

    def _failure(
        self,
        message: EmailMessage,
        classification: str,
        error_type: str | None,
        status_code: int | None,
        response_body: str | None = None,
    ) -> EmailSendResult:
        logger.warning(
            "email_send_failed",
            extra={
                "event": "email_send_failed",
                "provider": self.name,
                "classification": classification,
                "status_code": status_code,
                "error_type": error_type,
                "recipient_count": len(message.to),
                "email": message.to[0] if message.to else None,
                "template": message.template.value if message.template else None,
                # Truncated: a provider error body is diagnostic but unbounded,
                # and this is a log line, not a document.
                "provider_detail": (response_body or "")[:500] or None,
            },
        )
        return EmailSendResult(
            sent=False,
            provider=self.name,
            error=classification,
            status_code=status_code,
        )

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=self._settings.email_timeout_seconds,
                # No redirects: an email API that 302s is either misconfigured
                # or being intercepted, and following it would send the API key
                # to wherever it points.
                follow_redirects=False,
            )
        return self._client

    async def aclose(self) -> None:
        if self._client is not None and self._owns_client:
            await self._client.aclose()
        self._client = None

    async def healthcheck(self) -> tuple[bool, float | None]:
        """Configuration-only.

        Resend has no free "am I authorized" endpoint worth a request per
        readiness probe, and email is not on the API's critical path — a Resend
        outage should degrade notifications, not mark the backend unhealthy and
        pull it out of rotation.
        """
        return self.is_configured, None


def _normalize_tags(tags: list[dict[str, str]]) -> list[dict[str, str]]:
    """Resend wants `[{name, value}]`; call sites find `{key: value}` natural.

    Accept both so neither shape is a silent bug. Resend rejects a request with
    a malformed tag, and "your confirmation email didn't send because of a tag
    format" is a miserable thing to debug.
    """
    normalized: list[dict[str, str]] = []
    for tag in tags:
        if {"name", "value"} <= set(tag):
            normalized.append({"name": str(tag["name"]), "value": str(tag["value"])})
            continue
        for key, value in tag.items():
            normalized.append({"name": str(key), "value": str(value)})
    return normalized


def _classify_status(status_code: int) -> str:
    if status_code in (401, 403):
        return ERROR_UNAUTHORIZED
    if status_code == 429:
        return ERROR_RATE_LIMITED
    if 400 <= status_code < 500:
        return ERROR_REJECTED
    return ERROR_UPSTREAM


def _safe_json(response: httpx.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        return None


__all__ = ["ResendEmailProvider"]
