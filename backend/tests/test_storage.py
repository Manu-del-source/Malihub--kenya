"""Storage abstraction.

Two things are being tested:

* the parts that are real in Phase 8 — URL derivation, URL *ownership*, and the
  upload policy (size, MIME allowlist, magic bytes);
* the parts that are honestly stubbed — byte transfer returns 501 and makes no
  Cloudinary request.

The ownership check matters more than it looks. `next.config.ts` allowlists the
hostname `res.cloudinary.com`, which every Cloudinary customer shares; without
`is_own_url` a listing could point at another account's file and MaliHub would
serve it. That is the same gap `src/lib/validations/upload-security.ts` closes
on the frontend.
"""

from __future__ import annotations

import struct
from typing import Any

import pytest

from app.core.errors import NotImplementedFeatureError, StorageProviderError, StorageUploadRejectedError
from app.providers.storage.base import ALLOWED_IMAGE_MIME_TYPES, StorageProvider, StorageUploadRequest
from app.providers.storage.cloudinary import CloudinaryStorageProvider
from app.services.storage_service import StorageService
from tests.conftest import build_settings

# ─── Minimal valid image fixtures ────────────────────────────────────────────

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 24
JPEG_BYTES = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + b"\x00" * 24
GIF_BYTES = b"GIF89a" + b"\x00" * 24
WEBP_BYTES = b"RIFF" + struct.pack("<I", 20) + b"WEBPVP8 " + b"\x00" * 12
AVIF_BYTES = struct.pack(">I", 32) + b"ftypavif" + b"\x00" * 24
#: A valid PNG header followed by HTML. Passes a magic-byte check that only
#: looks at the first bytes, which is exactly why SVG is off the allowlist and
#: why the CDN must serve `Content-Type: image/*`.
POLYGLOT_BYTES = PNG_BYTES + b"<script>alert(1)</script>"


def upload_request(
    content: bytes = PNG_BYTES,
    *,
    content_type: str | None = "image/png",
    **kwargs: Any,
) -> StorageUploadRequest:
    return StorageUploadRequest(
        content=content,
        filename=kwargs.pop("filename", "photo.png"),
        content_type=content_type,
        **kwargs,
    )


@pytest.fixture
def cloudinary() -> CloudinaryStorageProvider:
    return CloudinaryStorageProvider(
        build_settings(cloudinary_cloud_name="malihub-ke", cloudinary_folder="malihub")
    )


# ─── URL derivation (implemented in Phase 8) ─────────────────────────────────


def test_public_url_is_derived_from_configuration(cloudinary: CloudinaryStorageProvider) -> None:
    assert (
        cloudinary.public_url("listings/abc123")
        == "https://res.cloudinary.com/malihub-ke/image/upload/listings/abc123"
    )


def test_public_url_supports_a_transformation(cloudinary: CloudinaryStorageProvider) -> None:
    url = cloudinary.public_url("listings/abc123", transformation="w_800,c_fill,f_auto")
    assert url == ("https://res.cloudinary.com/malihub-ke/image/upload/w_800,c_fill,f_auto/listings/abc123")


def test_public_url_rejects_a_transformation_that_could_escape_the_path(
    cloudinary: CloudinaryStorageProvider,
) -> None:
    """A `/` or a space in a transformation changes the URL's meaning."""
    for transformation in ("../../etc/passwd", "w_800 ../secret", "w 800", "t_named/../../x"):
        with pytest.raises(StorageProviderError):
            cloudinary.public_url("listings/abc", transformation=transformation)


def test_public_url_rejects_a_url_passed_as_an_identifier(
    cloudinary: CloudinaryStorageProvider,
) -> None:
    """Otherwise a caller could inject a second host into the delivery URL."""
    for identifier in ("https://evil.example/x.png", "//evil.example/x.png"):
        with pytest.raises(StorageProviderError):
            cloudinary.public_url(identifier)


def test_public_url_requires_configuration() -> None:
    unconfigured = CloudinaryStorageProvider(build_settings())
    with pytest.raises(StorageProviderError, match="not configured"):
        unconfigured.public_url("listings/abc")


def test_public_url_needs_no_credentials(cloudinary: CloudinaryStorageProvider) -> None:
    """Delivery URLs are public; building one must not require an API secret."""
    assert cloudinary.has_credentials is False
    assert cloudinary.public_url("listings/abc")


# ─── URL ownership (implemented in Phase 8) ──────────────────────────────────


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://res.cloudinary.com/malihub-ke/image/upload/v1/listings/a.jpg", True),
        ("http://res.cloudinary.com/malihub-ke/image/upload/a.jpg", True),
        # Same vendor, different customer — the case a hostname allowlist misses.
        ("https://res.cloudinary.com/someone-elses-cloud/image/upload/a.jpg", False),
        ("https://evil.example/malihub-ke/image/upload/a.jpg", False),
        ("https://res.cloudinary.com.evil.example/malihub-ke/a.jpg", False),
        ("file:///etc/passwd", False),
        ("javascript:alert(1)", False),
        ("", False),
        ("not a url", False),
    ],
)
def test_is_own_url(cloudinary: CloudinaryStorageProvider, url: str, expected: bool) -> None:
    assert cloudinary.is_own_url(url) is expected


def test_is_own_url_is_false_when_unconfigured() -> None:
    """An unconfigured provider must not claim to own every URL."""
    assert CloudinaryStorageProvider(build_settings()).is_own_url("https://res.cloudinary.com/x/y") is False


# ─── Upload policy (implemented in the base class) ───────────────────────────


@pytest.mark.parametrize(
    ("content", "mime"),
    [
        (PNG_BYTES, "image/png"),
        (JPEG_BYTES, "image/jpeg"),
        (GIF_BYTES, "image/gif"),
        (WEBP_BYTES, "image/webp"),
        (AVIF_BYTES, "image/avif"),
    ],
)
def test_magic_byte_detection(cloudinary: CloudinaryStorageProvider, content: bytes, mime: str) -> None:
    assert cloudinary.sniff_mime_type(content) == mime


def test_sniffing_rejects_text_pretending_to_be_an_image(cloudinary: CloudinaryStorageProvider) -> None:
    assert cloudinary.sniff_mime_type(b"<html><body>hello</body></html>") is None
    assert cloudinary.sniff_mime_type(b"MZ\x90\x00executable") is None
    assert cloudinary.sniff_mime_type(b"short") is None


def test_webp_requires_the_webp_marker_not_just_riff(
    cloudinary: CloudinaryStorageProvider,
) -> None:
    """`RIFF` alone is also WAV and AVI — the marker at offset 8 is the proof."""
    assert cloudinary.sniff_mime_type(b"RIFF" + struct.pack("<I", 20) + b"WAVEfmt " + b"\x00" * 12) is None


def test_declared_type_must_match_the_bytes(cloudinary: CloudinaryStorageProvider) -> None:
    """A file whose bytes say PNG and whose header says JPEG is refused.

    We cannot know which a downstream consumer will believe, so the only safe
    answer is neither.
    """
    with pytest.raises(StorageUploadRejectedError) as excinfo:
        cloudinary.validate_upload(upload_request(PNG_BYTES, content_type="image/jpeg"))
    assert excinfo.value.details is not None
    assert excinfo.value.details["reason"] == "type_mismatch"


def test_disallowed_mime_type_is_refused(cloudinary: CloudinaryStorageProvider) -> None:
    for content_type in ("image/svg+xml", "application/pdf", "text/html", "application/javascript"):
        with pytest.raises(StorageUploadRejectedError):
            cloudinary.validate_upload(
                upload_request(b"%PDF-1.4 not an image at all!!", content_type=content_type)
            )


def test_svg_is_not_an_allowed_image_type() -> None:
    """SVG is a script container with an image file extension."""
    assert "image/svg+xml" not in ALLOWED_IMAGE_MIME_TYPES


def test_oversize_upload_is_refused(cloudinary: CloudinaryStorageProvider) -> None:
    with pytest.raises(StorageUploadRejectedError) as excinfo:
        cloudinary.validate_upload(upload_request(b"\x89PNG\r\n\x1a\n" + b"\x00" * 2048, max_bytes=1024))
    assert excinfo.value.details is not None
    assert excinfo.value.details["reason"] == "too_large"


def test_empty_upload_is_refused(cloudinary: CloudinaryStorageProvider) -> None:
    with pytest.raises(StorageUploadRejectedError):
        cloudinary.validate_upload(upload_request(b""))


def test_unrecognized_content_is_refused_even_with_a_valid_content_type(
    cloudinary: CloudinaryStorageProvider,
) -> None:
    """The declared type is a string the uploader chose; the bytes are not."""
    with pytest.raises(StorageUploadRejectedError) as excinfo:
        cloudinary.validate_upload(upload_request(b"just some text, not an image", content_type="image/png"))
    assert excinfo.value.details["reason"] in {"unrecognized_content", "type_mismatch"}


@pytest.mark.parametrize(
    "folder",
    [
        "../etc",  # traversal
        "a/../b",  # traversal mid-path
        "folder/./x",  # current-dir segment
        "folder with space",  # space → needs URL encoding, invites mismatch
        "listings/2026/../../etc",  # deep traversal
        "a" * 400,  # unbounded segment
        "/".join(["a"] * 7),  # too many segments (max 6)
        "folder/",  # trailing separator
        "folder//x",  # doubled separator
    ],
)
def test_unsafe_folders_are_refused(cloudinary: CloudinaryStorageProvider, folder: str) -> None:
    """No `.` in a folder segment, so `..` traversal is excluded by shape."""
    with pytest.raises(StorageUploadRejectedError) as excinfo:
        cloudinary.validate_upload(upload_request(folder=folder))
    assert excinfo.value.details["reason"] == "unsafe_folder"


def test_safe_folders_are_accepted(cloudinary: CloudinaryStorageProvider) -> None:
    for folder in ("listings", "listings/2026", "avatars", "a/b/c/d/e/f", "product-images_v2"):
        cloudinary.validate_upload(upload_request(folder=folder))


@pytest.mark.parametrize("folder", ["", "   ", None])
def test_an_empty_folder_means_the_provider_root(
    cloudinary: CloudinaryStorageProvider, folder: str | None
) -> None:
    """`folder=""` is "no folder", not a malformed path.

    Callers that build the destination conditionally (`folder = f"listings/{year}"
    if year else ""`) must not get a 422 for the unset case.
    """
    cloudinary.validate_upload(upload_request(PNG_BYTES, folder=folder))


def test_rejection_message_does_not_reveal_which_check_failed(
    cloudinary: CloudinaryStorageProvider,
) -> None:
    """These checks exist to stop probing; the reason goes to the log, not the
    response."""
    with pytest.raises(StorageUploadRejectedError) as excinfo:
        cloudinary.validate_upload(upload_request(PNG_BYTES, content_type="image/jpeg"))
    assert "magic" not in excinfo.value.message.lower()
    assert "mismatch" not in excinfo.value.message.lower()
    assert excinfo.value.details is not None and excinfo.value.details["reason"] == "type_mismatch"


# ─── Transfer operations (stubbed in Phase 8) ────────────────────────────────


def test_upload_is_a_stub_that_still_enforces_policy(cloudinary: CloudinaryStorageProvider) -> None:
    """A bad file gets the real 422; a good file gets an honest 501."""
    import asyncio

    with pytest.raises(StorageUploadRejectedError):
        asyncio.run(cloudinary.upload(upload_request(b"not an image", content_type="image/png")))

    with pytest.raises(NotImplementedFeatureError) as excinfo:
        asyncio.run(cloudinary.upload(upload_request()))
    assert excinfo.value.status_code == 501
    assert "browser" in excinfo.value.message  # explains where uploads happen today


def test_upload_makes_no_network_call(
    cloudinary: CloudinaryStorageProvider, monkeypatch: pytest.MonkeyPatch
) -> None:
    import asyncio

    import httpx

    def _explode(*args: Any, **kwargs: Any) -> Any:
        raise AssertionError("Cloudinary stub attempted an outbound HTTP request")

    monkeypatch.setattr(httpx.AsyncClient, "post", _explode)
    monkeypatch.setattr(httpx.AsyncClient, "request", _explode)

    with pytest.raises(NotImplementedFeatureError):
        asyncio.run(cloudinary.upload(upload_request()))


def test_delete_is_a_stub(cloudinary: CloudinaryStorageProvider) -> None:
    import asyncio

    with pytest.raises(NotImplementedFeatureError) as excinfo:
        asyncio.run(cloudinary.delete("listings/abc"))
    assert excinfo.value.status_code == 501

    with pytest.raises(StorageProviderError):
        asyncio.run(cloudinary.delete("   "))


# ─── Service facade ──────────────────────────────────────────────────────────


def test_service_resolves_the_configured_provider() -> None:
    service = StorageService(build_settings(cloudinary_cloud_name="malihub-ke"))
    assert isinstance(service.provider, StorageProvider)
    assert service.provider.name == "cloudinary"
    # Constructed once, not per call.
    assert service.provider is service.provider


def test_service_with_storage_disabled_raises_rather_than_losing_bytes() -> None:
    """A silent no-op would discard the file and report success."""
    service = StorageService(build_settings(storage_provider="none"))
    with pytest.raises(Exception) as excinfo:
        _ = service.provider
    assert "not configured" in str(excinfo.value).lower()


def test_service_validates_before_delegating() -> None:
    """The service boundary validates too, so a future adapter that forgets
    cannot ship an unvalidated upload path."""
    import asyncio

    service = StorageService(build_settings(cloudinary_cloud_name="malihub-ke"))
    with pytest.raises(StorageUploadRejectedError):
        asyncio.run(service.upload(upload_request(b"not an image", content_type="image/png")))


def test_service_exposes_ownership_check() -> None:
    service = StorageService(build_settings(cloudinary_cloud_name="malihub-ke"))
    assert service.is_own_url("https://res.cloudinary.com/malihub-ke/image/upload/a.jpg")
    assert not service.is_own_url("https://res.cloudinary.com/other-cloud/image/upload/a.jpg")
