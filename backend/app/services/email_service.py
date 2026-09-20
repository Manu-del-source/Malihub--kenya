"""EmailService — transactional email, provider-neutral.

    caller  ──▶  EmailService  ──▶  EmailProvider  ──▶  ResendEmailProvider

Two jobs: render a template, and hand the result to whichever provider is
configured. Callers ask for "tell this user their payment arrived", not for
"POST to Resend".

**Email never fails an operation.** `send()` returns an `EmailSendResult` and
does not raise for a delivery problem, matching both the Phase 6 frontend
service (`src/services/email-service.ts`) and the principle it encodes: email
is an enhancement on top of in-app notifications, never the only channel. A
recorded payment whose confirmation email bounced is a recorded payment; a
recorded payment rolled back because Resend was down is a support ticket.
Callers that genuinely must block on delivery should inspect the result and
decide for themselves — nothing in this service will make that choice for them.

Template scope for Phase 8: `GENERIC_NOTIFICATION`, a Python port of
`src/emails/notification-email.tsx`. It renders the same markup and the same
design tokens as the React version, so an email triggered from the backend is
visually identical to one triggered from the frontend. The other
`EmailTemplateKind` values are declared but have no renderer — writing copy for
flows that don't exist yet would be guesswork, and `render()` says so plainly
rather than sending a blank email.
"""

from __future__ import annotations

from html import escape
from typing import Any

from app.core.config import Settings, get_settings
from app.core.logging import get_logger
from app.providers.email.base import EmailMessage, EmailProvider, EmailSendResult, EmailTemplateKind
from app.providers.email.resend import ResendEmailProvider

logger = get_logger(__name__)

_ADAPTERS: dict[str, type[EmailProvider]] = {
    ResendEmailProvider.name: ResendEmailProvider,
}

#: Templates with a renderer. Anything else raises a clear error instead of
#: sending an empty email — a blank "Your payment failed" message is worse than
#: no message, because it reads as a real notification about a real event.
_RENDERABLE_TEMPLATES = frozenset({EmailTemplateKind.GENERIC_NOTIFICATION})


class EmailTemplateNotAvailableError(LookupError):
    """A declared template has no renderer yet.

    A `LookupError` (not an `ApiError`) because this is a programming mistake,
    not a user-facing condition: it means a call site asked for copy that was
    never written. It should be caught in development by a test, never in
    production by a customer.
    """


class EmailService:
    """Render + deliver, with the provider resolved from configuration."""

    def __init__(self, settings: Settings | None = None, provider: EmailProvider | None = None) -> None:
        self._settings = settings or get_settings()
        self._provider = provider

    @property
    def provider(self) -> EmailProvider:
        """The configured adapter. `email_provider="none"` still resolves —
        to an unconfigured Resend — so a caller gets a clean `skipped` result
        rather than an exception for an environment that simply has no email."""
        if self._provider is not None:
            return self._provider
        name = self._settings.email_provider
        adapter_class = _ADAPTERS.get(name, ResendEmailProvider)
        self._provider = adapter_class(self._settings)
        return self._provider

    @property
    def is_configured(self) -> bool:
        return self.provider.is_configured

    async def send(self, message: EmailMessage) -> EmailSendResult:
        """Render (if needed) and deliver one email. Never raises for delivery."""
        resolved = self._render(message)
        try:
            return await self.provider.send(resolved)
        except Exception as exc:
            # A provider that raises despite its contract shouldn't take the
            # caller down. Type only in the log: provider exceptions can carry
            # the request, including the Authorization header.
            logger.error(
                "email_service_error",
                exc_info=True,
                extra={
                    "event": "email_service_error",
                    "provider": self.provider.name,
                    "error_type": type(exc).__name__,
                    "template": resolved.template.value if resolved.template else None,
                },
            )
            return EmailSendResult(
                sent=False,
                provider=self.provider.name,
                error="email_service_error",
            )

    async def send_notification(
        self,
        *,
        to: str | list[str],
        heading: str,
        body: str,
        cta_label: str | None = None,
        cta_url: str | None = None,
        tags: list[dict[str, str]] | None = None,
    ) -> EmailSendResult:
        """The generic MaliHub notification. Python twin of `notifyUser()`'s
        email leg in `src/services/notification-service.ts`."""
        return await self.send(
            EmailMessage(
                to=to,
                subject=heading,
                template=EmailTemplateKind.GENERIC_NOTIFICATION,
                template_context={
                    "heading": heading,
                    "body": body,
                    "cta_label": cta_label,
                    "cta_url": cta_url,
                },
                tags=tags or [],
            )
        )

    # ─── Rendering ──────────────────────────────────────────────────────────

    def _render(self, message: EmailMessage) -> EmailMessage:
        """Produce a message with an html/text body, rendering if necessary."""
        if message.html or message.text:
            return message
        if message.template is None:
            return message  # no body at all — the provider reports it

        if message.template not in _RENDERABLE_TEMPLATES:
            raise EmailTemplateNotAvailableError(
                f"No renderer exists for the {message.template.value!r} email template. "
                "It is declared in EmailTemplateKind but deliberately unbuilt — "
                "add a renderer in services/email_service.py when the flow that "
                "needs it exists."
            )

        html = render_generic_notification(message.template_context)
        text = render_generic_notification_text(message.template_context)
        # `model_copy(update=…)` rather than mutating: EmailMessage has
        # validate_assignment on, and a caller's message object should not be
        # changed as a side effect of sending it.
        return message.model_copy(update={"html": html, "text": text})


def render_generic_notification(context: dict[str, Any]) -> str:
    """HTML port of `src/emails/notification-email.tsx`.

    Same structure, same design tokens (`#f4f2ef` page, `#d97706` accent,
    480px card, 16px radius) so the two runtimes produce indistinguishable
    email. If that template's design changes, change this too — they are the
    same template in two languages, and drift between them is invisible until
    a customer sees it.

    Every interpolated value is HTML-escaped. `heading`, `body` and the CTA
    label come from application data that can contain user input (a listing
    title, a seller's business name), and an email client that renders HTML is
    an injection target like any other. The CTA URL is escaped *and* restricted
    to http(s), so a `javascript:` URL from a stored field cannot become a
    clickable one.
    """
    heading = str(context.get("heading") or "MaliHub Kenya")
    body = str(context.get("body") or "")
    cta_label = context.get("cta_label")
    cta_url = context.get("cta_url")

    cta_html = ""
    if cta_label and cta_url:
        safe_url = _safe_url(str(cta_url))
        if safe_url:
            cta_html = f"""
          <tr>
            <td style="padding-top:24px;">
              <a href="{escape(safe_url, quote=True)}"
                 style="background-color:#d97706;color:#ffffff;border-radius:999px;
                        padding:12px 24px;font-size:14px;font-weight:600;
                        text-decoration:none;display:inline-block;">
                {escape(str(cta_label))}
              </a>
            </td>
          </tr>"""

    return f"""<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{escape(heading)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f4f2ef;
               font-family:Helvetica,Arial,sans-serif;">
    <!-- Preheader: shown in the inbox list. Matches the React <Preview>. -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">{escape(heading)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="background-color:#f4f2ef;padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0"
                 style="max-width:480px;width:100%;background-color:#ffffff;
                        border-radius:16px;padding:40px;">
            <tr>
              <td style="font-size:13px;color:#d97706;font-weight:600;
                         letter-spacing:0.05em;">
                MALIHUB KENYA
              </td>
            </tr>
            <tr>
              <td style="font-size:22px;color:#1c1508;font-weight:700;
                         padding:12px 0;line-height:1.3;">
                {escape(heading)}
              </td>
            </tr>
            <tr>
              <td style="font-size:15px;color:#4b4536;line-height:1.6;">
                {escape(body)}
              </td>
            </tr>{cta_html}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""


def render_generic_notification_text(context: dict[str, Any]) -> str:
    """Plain-text alternative. Every client deserves one, and some require it."""
    heading = str(context.get("heading") or "MaliHub Kenya")
    body = str(context.get("body") or "")
    cta_label = context.get("cta_label")
    cta_url = context.get("cta_url")
    parts = ["MALIHUB KENYA", heading, "", body]
    if cta_label and cta_url:
        safe_url = _safe_url(str(cta_url))
        if safe_url:
            parts += ["", f"{cta_label}: {safe_url}"]
    return "\n".join(parts)


def _safe_url(url: str) -> str | None:
    """Allow only http(s) URLs, and only ones we would put in an email.

    Blocks `javascript:`, `data:` and `file:` — all of which some clients will
    happily make clickable. An unanchored CTA is the difference between a
    notification and a phishing vector, and the URL frequently originates from
    a stored field a user controls.
    """
    stripped = url.strip()
    if not stripped:
        return None
    lowered = stripped.lower()
    if not (lowered.startswith("http://") or lowered.startswith("https://")):
        return None
    if any(control in stripped for control in ("\n", "\r", "\t", " ", '"', "'", "<", ">")):
        # Whitespace and quotes in a URL are how an href attribute gets broken
        # out of. A legitimate CTA never contains them.
        return None
    return stripped


_service: EmailService | None = None


def get_email_service() -> EmailService:
    """Process-wide singleton, and the FastAPI dependency for email sends."""
    global _service
    if _service is None:
        _service = EmailService()
    return _service


def reset_email_service() -> None:
    global _service
    _service = None


__all__ = [
    "EmailService",
    "EmailTemplateNotAvailableError",
    "get_email_service",
    "render_generic_notification",
    "render_generic_notification_text",
    "reset_email_service",
]
