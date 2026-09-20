"""Email abstraction and the Resend adapter.

Unlike the payment and storage stubs, Resend is implemented: it is already
MaliHub's provider on the frontend, and it is inert without an API key. What is
tested here is therefore real behaviour — the payload it builds, the failure
modes it survives, and the guarantee that a delivery problem never becomes an
application problem.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from app.providers.email.base import EmailMessage, EmailSendResult, EmailTemplateKind
from app.providers.email.resend import ResendEmailProvider
from app.services.email_service import (
    EmailService,
    EmailTemplateNotAvailableError,
    render_generic_notification,
    render_generic_notification_text,
)
from tests.conftest import build_settings


def mock_resend(handler: Any) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def capture_handler(captured: dict[str, Any], *, status: int = 200, body: Any = None) -> Any:
    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["headers"] = dict(request.headers)
        captured["body"] = json.loads(request.content) if request.content else None
        return httpx.Response(status, json=body if body is not None else {"id": "re_123"})

    return handler


# ─── Rendering ───────────────────────────────────────────────────────────────


def test_generic_notification_matches_the_react_template() -> None:
    """Same design tokens as `src/emails/notification-email.tsx`.

    The two runtimes must produce indistinguishable email; this pins the tokens
    so a change on one side shows up as a failing test rather than as drift.
    """
    html = render_generic_notification({"heading": "Payment received", "body": "KSh 1,500 for order MH-1."})
    for token in ("#f4f2ef", "#d97706", "#1c1508", "#4b4536", "480px", "16px", "MALIHUB KENYA"):
        assert token in html, token
    assert "Payment received" in html
    assert "KSh 1,500 for order MH-1." in html


def test_rendered_html_escapes_user_supplied_content() -> None:
    """Headings and bodies routinely contain a listing title or a business name,
    both of which are user input."""
    html = render_generic_notification(
        {
            "heading": '<script>alert("xss")</script>',
            "body": '<img src=x onerror="steal()">',
            "cta_label": "Click <b>here</b>",
            "cta_url": "https://malihub.co.ke/orders/1",
        }
    )
    assert "<script>" not in html
    assert "<img src=x" not in html
    assert "<b>here</b>" not in html
    assert "&lt;script&gt;" in html
    assert "&lt;img src=x" in html


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "file:///etc/passwd",
        "vbscript:msgbox",
        'https://malihub.co.ke/" onload="alert(1)',
        "https://malihub.co.ke/\nX-Injected: true",
        "https://malihub.co.ke/<script>",
        "",
    ],
)
def test_unsafe_cta_urls_are_dropped(url: str) -> None:
    """An unanchored CTA is the difference between a notification and phishing,
    and the URL often originates from a stored field a user controls."""
    html = render_generic_notification({"heading": "H", "body": "B", "cta_label": "Open", "cta_url": url})
    assert "<a href=" not in html


def test_safe_cta_url_is_rendered() -> None:
    html = render_generic_notification(
        {
            "heading": "H",
            "body": "B",
            "cta_label": "View order",
            "cta_url": "https://malihub.co.ke/dashboard/buyer/orders/1",
        }
    )
    assert 'href="https://malihub.co.ke/dashboard/buyer/orders/1"' in html
    assert "View order" in html


def test_plain_text_alternative_is_produced() -> None:
    text = render_generic_notification_text(
        {
            "heading": "Payment received",
            "body": "KSh 1,500.",
            "cta_label": "View",
            "cta_url": "https://malihub.co.ke/o/1",
        }
    )
    assert "MALIHUB KENYA" in text
    assert "Payment received" in text
    assert "https://malihub.co.ke/o/1" in text
    assert "<" not in text


def test_unbuilt_templates_are_declared_but_not_renderable() -> None:
    """The vocabulary is fixed now; the copy belongs with the flows that need
    it, which don't exist yet."""
    from app.services.email_service import _RENDERABLE_TEMPLATES

    assert frozenset({EmailTemplateKind.GENERIC_NOTIFICATION}) == _RENDERABLE_TEMPLATES
    assert EmailTemplateKind.PAYMENT_FAILED not in _RENDERABLE_TEMPLATES

    service = EmailService(build_settings())
    with pytest.raises(EmailTemplateNotAvailableError, match="No renderer exists"):
        service._render(EmailMessage(to="a@b.c", subject="s", template=EmailTemplateKind.PAYMENT_FAILED))


def test_unbuilt_template_never_sends_a_blank_email() -> None:
    """A blank "Your payment failed" is worse than no email: it reads as a real
    notification about a real event."""
    import asyncio

    captured: dict[str, Any] = {}
    service = EmailService(
        build_settings(resend_api_key="re_test_key"),
        provider=ResendEmailProvider(
            build_settings(resend_api_key="re_test_key"), client=mock_resend(capture_handler(captured))
        ),
    )
    with pytest.raises(EmailTemplateNotAvailableError):
        asyncio.run(
            service.send(EmailMessage(to="a@b.c", subject="s", template=EmailTemplateKind.PAYMENT_FAILED))
        )
    assert captured == {}


# ─── Message model ───────────────────────────────────────────────────────────


def test_recipients_are_normalized_and_deduplicated() -> None:
    message = EmailMessage(to=["A@Example.com", "a@example.com", "  "], subject="s", text="body")
    assert message.to == ["a@example.com"]


def test_a_bare_string_recipient_is_accepted() -> None:
    assert EmailMessage(to="a@b.c", subject="s", text="body").to == ["a@b.c"]


def test_subject_newlines_are_stripped() -> None:
    """A CR/LF in a subject is a header-injection attempt."""
    message = EmailMessage(to="a@b.c", subject="Hello\r\nBcc: victim@evil.example", text="body")
    assert "\r" not in message.subject and "\n" not in message.subject


def test_a_message_with_no_body_is_refused() -> None:
    from pydantic import ValidationError as PydanticValidationError

    with pytest.raises((PydanticValidationError, ValueError)):
        EmailMessage(to="a@b.c", subject="s")


# ─── Resend adapter ──────────────────────────────────────────────────────────


def test_unconfigured_provider_skips_without_calling_resend() -> None:
    """Matches `src/services/email-service.ts`: local dev needs no Resend
    account, and a skipped email is neither queued nor retried."""
    import asyncio

    captured: dict[str, Any] = {}
    provider = ResendEmailProvider(build_settings(), client=mock_resend(capture_handler(captured)))
    result = asyncio.run(provider.send(EmailMessage(to="a@b.c", subject="s", text="body")))

    assert isinstance(result, EmailSendResult)
    assert result.sent is False
    assert result.skipped is True
    assert captured == {}


def test_send_builds_the_resend_payload() -> None:
    import asyncio

    captured: dict[str, Any] = {}
    settings = build_settings(resend_api_key="re_test_key", email_from="MaliHub <hi@malihub.co.ke>")
    provider = ResendEmailProvider(settings, client=mock_resend(capture_handler(captured)))

    result = asyncio.run(
        provider.send(
            EmailMessage(
                to=["a@b.c"],
                subject="Payment received",
                html="<p>hi</p>",
                text="hi",
                tags=[{"category": "payment"}],
            )
        )
    )

    assert result.sent is True
    assert result.provider_message_id == "re_123"
    assert captured["url"] == "https://api.resend.com/emails"
    assert captured["headers"]["authorization"] == "Bearer re_test_key"
    assert captured["body"]["from"] == "MaliHub <hi@malihub.co.ke>"
    assert captured["body"]["to"] == ["a@b.c"]
    assert captured["body"]["html"] == "<p>hi</p>"
    assert captured["body"]["tags"] == [{"name": "category", "value": "payment"}]


def test_api_key_is_not_in_the_url() -> None:
    """A key in a query string ends up in every proxy and access log."""
    import asyncio

    captured: dict[str, Any] = {}
    provider = ResendEmailProvider(
        build_settings(resend_api_key="re_test_key"),
        client=mock_resend(capture_handler(captured)),
    )
    asyncio.run(provider.send(EmailMessage(to="a@b.c", subject="s", text="b")))
    assert "re_test_key" not in captured["url"]


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (401, "provider_credentials_rejected"),
        (403, "provider_credentials_rejected"),
        (422, "provider_rejected_message"),
        (429, "provider_rate_limited"),
        (500, "provider_unavailable"),
        (503, "provider_unavailable"),
    ],
)
def test_provider_failures_are_reported_not_raised(status: int, expected: str) -> None:
    """A delivery failure must never take down the operation that triggered it."""
    import asyncio

    provider = ResendEmailProvider(
        build_settings(resend_api_key="re_test_key"),
        client=mock_resend(capture_handler({}, status=status, body={"message": "nope"})),
    )
    result = asyncio.run(provider.send(EmailMessage(to="a@b.c", subject="s", text="b")))
    assert result.sent is False
    assert result.error == expected
    assert result.status_code == status


def test_provider_error_body_is_not_surfaced_to_callers() -> None:
    """It can carry account identifiers and the shape of the rejected key."""
    import asyncio

    provider = ResendEmailProvider(
        build_settings(resend_api_key="re_test_key"),
        client=mock_resend(
            capture_handler(
                {}, status=401, body={"message": "Invalid API key re_test_key for account acct_99"}
            )
        ),
    )
    result = asyncio.run(provider.send(EmailMessage(to="a@b.c", subject="s", text="b")))
    assert "re_test_key" not in (result.error or "")
    assert "acct_99" not in (result.error or "")


def test_transport_errors_do_not_raise() -> None:
    import asyncio

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    provider = ResendEmailProvider(build_settings(resend_api_key="re_test_key"), client=mock_resend(handler))
    result = asyncio.run(provider.send(EmailMessage(to="a@b.c", subject="s", text="b")))
    assert result.sent is False
    assert result.error == "provider_unavailable"


def test_timeouts_do_not_raise() -> None:
    import asyncio

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out")

    provider = ResendEmailProvider(build_settings(resend_api_key="re_test_key"), client=mock_resend(handler))
    result = asyncio.run(provider.send(EmailMessage(to="a@b.c", subject="s", text="b")))
    assert result.error == "provider_timeout"


def test_no_redirects_are_followed() -> None:
    """An email API that 302s is either misconfigured or being intercepted, and
    following it would send the API key to wherever it points."""
    import asyncio

    redirected: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/emails":
            return httpx.Response(302, headers={"Location": "https://evil.example/collect"})
        redirected["hit"] = str(request.url)
        return httpx.Response(200, json={"id": "x"})

    provider = ResendEmailProvider(build_settings(resend_api_key="re_test_key"), client=mock_resend(handler))
    result = asyncio.run(provider.send(EmailMessage(to="a@b.c", subject="s", text="b")))
    assert result.sent is False
    assert "hit" not in redirected


# ─── Service facade ──────────────────────────────────────────────────────────


def test_service_renders_then_delivers() -> None:
    import asyncio

    captured: dict[str, Any] = {}
    settings = build_settings(resend_api_key="re_test_key")
    service = EmailService(
        settings,
        provider=ResendEmailProvider(settings, client=mock_resend(capture_handler(captured))),
    )
    result = asyncio.run(
        service.send_notification(
            to="jane@example.com",
            heading="Payment received",
            body="KSh 1,500 for order MH-1.",
            cta_label="View order",
            cta_url="https://malihub.co.ke/dashboard/buyer/orders/1",
        )
    )
    assert result.sent is True
    assert "MALIHUB KENYA" in captured["body"]["html"]
    assert "Payment received" in captured["body"]["html"]
    assert captured["body"]["text"]


def test_service_does_not_mutate_the_callers_message() -> None:
    import asyncio

    settings = build_settings(resend_api_key="re_test_key")
    service = EmailService(
        settings,
        provider=ResendEmailProvider(settings, client=mock_resend(capture_handler({}))),
    )
    message = EmailMessage(
        to="a@b.c",
        subject="s",
        template=EmailTemplateKind.GENERIC_NOTIFICATION,
        template_context={"heading": "H", "body": "B"},
    )
    asyncio.run(service.send(message))
    assert message.html is None, "the caller's message must not gain a body as a side effect"


def test_service_survives_a_provider_that_breaks_its_contract() -> None:
    """A provider that raises anyway must not take the caller down."""
    import asyncio

    class _Broken(ResendEmailProvider):
        async def send(self, message: EmailMessage) -> EmailSendResult:
            raise RuntimeError("provider exploded")

    service = EmailService(build_settings(resend_api_key="re_test_key"), provider=_Broken(build_settings()))
    result = asyncio.run(service.send(EmailMessage(to="a@b.c", subject="s", text="b")))
    assert result.sent is False
    assert result.error == "email_service_error"
