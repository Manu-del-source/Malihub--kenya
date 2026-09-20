"""Cloudinary storage adapter.

╔══════════════════════════════════════════════════════════════════════════╗
║  PARTIAL STUB. No Cloudinary API call is made anywhere in Phase 8.        ║
╚══════════════════════════════════════════════════════════════════════════╝

The split is deliberate, and it is what makes this more than a placeholder:

  Implemented, working today, no network and no credentials required
    • `public_url()`   — derive a delivery URL from a stored identifier
    • `is_own_url()`   — prove a URL belongs to *our* cloud, not just to
                         Cloudinary
    • `validate_upload()` / `sniff_mime_type()` — inherited from the base
                         class: size ceiling, MIME allowlist, magic-byte check

  Stubbed — raises `NotImplementedFeatureError` (HTTP 501)
    • `upload()`       — needs Cloudinary's signed upload API
    • `delete()`       — needs the destroy endpoint

`public_url` and `is_own_url` are pure functions of configuration, so they are
real and unit-tested now. That matters because the frontend already depends on
exactly this logic: `src/lib/validations/upload-security.ts` validates that a
listing image URL belongs to our Cloudinary cloud before it is persisted, and
`next.config.ts` restricts `next/image` to `res.cloudinary.com`. This adapter
is the backend's side of the same boundary, and having it correct in Phase 8
means Phase 9 only has to add the two network calls.

Why uploads are stubbed rather than built: MaliHub's images are uploaded
directly from the browser by `next-cloudinary`'s unsigned widget
(`NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET`), so no server-side upload path is
needed by anything that exists today. Building one now would be an unused
integration holding live credentials — the definition of a fake production
integration. When a server-side upload is actually required (admin bulk import,
a provider callback attachment, message images moderated before publish) this
is where it goes.

PHASE 9+ CHECKLIST (when a server-side upload path is needed)
 1. One shared `httpx.AsyncClient`, closed on shutdown.
 2. Signed upload: `POST {CLOUDINARY_BASE_URL}/{cloud}/auto/upload` with
    `timestamp` + `signature = sha1(params + api_secret)`, or the eager form.
    Credentials from `SecretStr`, unwrapped at call time, never stored.
 3. Call `self.validate_upload(request)` first — it is the policy boundary and
    it is already written.
 4. Generate the `public_id` server-side unless the caller has a legitimate
    reason to choose one, and prefix it with `settings.cloudinary_folder` so a
    stray write cannot land at the cloud root.
 5. Honour `request.overwrite=False` (Cloudinary's default is to overwrite).
 6. Return `raw` verbatim in `StoredObject.raw` for debugging, and make sure
    nothing serializes it into an API response.
 7. `delete()` → `POST {CLOUDINARY_BASE_URL}/{cloud}/auto/destroy`.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

from app.core.config import Settings, get_settings
from app.core.errors import NotImplementedFeatureError, StorageProviderError
from app.core.logging import get_logger, safe_extra
from app.providers.storage.base import StorageProvider, StorageUploadRequest, StoredObject

logger = get_logger(__name__)


class CloudinaryStorageProvider(StorageProvider):
    """Adapter for Cloudinary. URL logic implemented; transfer operations stubbed."""

    name = "cloudinary"
    display_name = "Cloudinary"

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self.cloud_name = self._settings.cloudinary_cloud_name
        self.folder = (self._settings.cloudinary_folder or "malihub").strip("/")
        self.max_upload_bytes = self._settings.storage_max_upload_bytes
        self._secure_base_url = self._settings.cloudinary_secure_base_url.rstrip("/")

    @property
    def is_configured(self) -> bool:
        """True when a cloud name exists — enough to build and validate URLs.

        Upload/delete additionally need the API key and secret; those are
        checked in the (stubbed) transfer methods, not here, so that URL
        derivation keeps working for a read-only deployment.
        """
        return bool(self.cloud_name)

    @property
    def has_credentials(self) -> bool:
        return bool(self._settings.cloudinary_api_key and self._settings.cloudinary_api_secret)

    # ─── Implemented: URL derivation and ownership ──────────────────────────

    def public_url(
        self,
        public_id: str,
        *,
        resource_type: str = "image",
        transformation: str | None = None,
    ) -> str:
        """`https://res.cloudinary.com/<cloud>/<resource_type>/upload[/t]/<public_id>`

        Pure string construction from configuration — no credentials, no
        network. Raises rather than returning a malformed URL, because a URL
        built from an empty cloud name doesn't just 404: it can resolve into
        Cloudinary's default namespace, which is someone else's.
        """
        if not self.is_configured:
            raise StorageProviderError(
                "Cloudinary is not configured (CLOUDINARY_CLOUD_NAME is missing).",
                details={"provider": self.name},
            )
        if not public_id or not public_id.strip():
            raise StorageProviderError("A public_id is required to build a storage URL.")

        # Reject URL-ish and URL-altering input *before* normalizing. Order
        # matters: stripping a leading "/" first turns the protocol-relative
        # "//evil.example/x.png" into "evil.example/x.png", which then looks
        # like an ordinary path and gets a real URL built around it. Checking
        # the raw string catches it. `?` and `#` are rejected for the same
        # class of reason — the result is interpolated into a path, so either
        # one would let a caller append a query string or a fragment.
        raw = public_id.strip()
        if "://" in raw or raw.startswith("//") or any(c in raw for c in ("?", "#")):
            raise StorageProviderError(
                "public_id must be an identifier, not a URL.",
                details={"provider": self.name},
            )
        identifier = raw.lstrip("/")
        if not identifier:
            raise StorageProviderError("A public_id is required to build a storage URL.")

        segments = [self._secure_base_url, self.cloud_name, resource_type, "upload"]
        if transformation:
            # Transformations are part of the path, so a `/` or a space in one
            # changes the URL's meaning. Only a narrow, signed-free preset
            # syntax is accepted.
            if not _SAFE_TRANSFORMATION.match(transformation):
                raise StorageProviderError("Unsupported Cloudinary transformation.")
            segments.append(transformation)
        segments.append(identifier)
        return "/".join(segments)

    def is_own_url(self, url: str) -> bool:
        """True only for an asset in *our* Cloudinary cloud.

        Backend equivalent of `isOwnCloudinaryUrl()` in
        `src/lib/validations/upload-security.ts` — same rule, same reason:
        `next.config.ts` allowlists the hostname `res.cloudinary.com`, which
        every Cloudinary customer shares. The cloud name in the first path
        segment is what identifies *ours*.
        """
        if not self.is_configured or not url:
            return False
        try:
            parsed = urlparse(url)
        except ValueError:
            return False
        if parsed.scheme not in {"http", "https"}:
            return False
        expected_host = self._secure_base_url.split("://", 1)[-1].split("/", 1)[0]
        if parsed.hostname != expected_host:
            return False
        return parsed.path.startswith(f"/{self.cloud_name}/")

    # ─── Stubbed: transfer operations ───────────────────────────────────────

    async def upload(self, request: StorageUploadRequest) -> StoredObject:
        """NOT IMPLEMENTED in Phase 8 — no Cloudinary request is made.

        The policy check still runs, so a caller wiring this up early gets the
        real 422s for a bad file and an honest 501 for the transfer itself,
        rather than a silent success.
        """
        self.validate_upload(request)
        self._refuse(
            "upload",
            "Server-side Cloudinary uploads are not implemented. "
            "Listing images are uploaded directly from the browser via "
            "next-cloudinary's unsigned widget; no server-side upload path "
            "exists yet. Nothing was sent to Cloudinary.",
            filename=request.filename,
            size_bytes=len(request.content),
        )

    async def delete(self, public_id: str, *, resource_type: str = "image") -> bool:
        """NOT IMPLEMENTED in Phase 8 — no Cloudinary request is made."""
        if not public_id or not public_id.strip():
            raise StorageProviderError("A public_id is required to delete a stored object.")
        self._refuse(
            "delete",
            "Server-side Cloudinary deletion is not implemented. "
            "Nothing was sent to Cloudinary and no object was removed.",
            resource_type=resource_type,
        )

    async def healthcheck(self) -> tuple[bool, float | None]:
        """Configuration-only check; no billable Cloudinary call."""
        return self.is_configured, None

    # ─── Internals ──────────────────────────────────────────────────────────

    def _refuse(self, operation: str, message: str, **context: Any) -> None:
        # `safe_extra` because callers pass `filename=...`, and `filename` is a
        # reserved LogRecord attribute — stdlib logging raises KeyError on it.
        logger.warning(
            "storage_provider_not_implemented",
            extra=safe_extra(
                **{
                    **context,
                    "event": "storage_provider_not_implemented",
                    "provider": self.name,
                    "operation": operation,
                    "configured": self.is_configured,
                    "has_credentials": self.has_credentials,
                }
            ),
        )
        raise NotImplementedFeatureError(message, details={"provider": self.name, "operation": operation})


#: Cloudinary transformation segment, restricted to the comma/underscore form
#: (`w_800,c_fill,q_auto,f_auto`). Excludes `/`, whitespace and anything that
#: could start a new path segment or a named transformation reference.
_SAFE_TRANSFORMATION = re.compile(r"^[A-Za-z0-9_,:]{1,120}$")


__all__ = ["CloudinaryStorageProvider"]
