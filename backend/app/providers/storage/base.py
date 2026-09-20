"""Storage provider contract.

    StorageService  (app/services/storage_service.py)
          │
          ▼
    StorageProvider  ← this module
          │
          └── CloudinaryStorageProvider  (providers/storage/cloudinary.py)

**Storage is external and is never Supabase Storage.** Supabase is MaliHub's
authentication provider only; putting user files in its storage bucket would
re-couple the application data plane to the identity provider that Phase 8
exists to decouple. (The one exception predates this decision and stays where
it is: profile *avatars* are uploaded to a Supabase Storage bucket by the
Phase 4 onboarding flow, because that flow is already talking to Supabase. It
is not part of this abstraction and no new feature should extend it — see
ARCHITECTURE.md §10a.)

Three operations, which is what the marketplace actually needs:

* `upload`     — put bytes in, get a stable identifier and a URL back
* `delete`     — remove by that identifier
* `public_url` — turn an identifier into a deliverable URL

`public_url` is separate from `upload` and is not optional, because the
identifier is what gets persisted (in `product_images.cloudinary_id`) and the
URL is derived from it on every read. Storing only URLs would mean a provider
or folder change invalidates every row.

Upload policy lives *here*, in the base class, not in each adapter: the size
ceiling, the MIME allowlist and the magic-byte check are properties of what
MaliHub accepts, not of who stores it. An adapter that implemented them itself
would be one careless rewrite away from a version that didn't. This mirrors the
frontend's split — `src/lib/validations/upload-security.ts` owns "is this URL
ours", and this owns "may these bytes be stored".
"""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any, ClassVar

from pydantic import BaseModel, ConfigDict, Field

from app.core.errors import StorageProviderError, StorageUploadRejectedError
from app.core.logging import safe_extra

#: What MaliHub accepts as an image. Deliberately short: every additional
#: format is another decoder to keep patched, and SVG in particular is excluded
#: because it is a script container with an image file extension.
ALLOWED_IMAGE_MIME_TYPES: frozenset[str] = frozenset(
    {
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/avif",
        "image/gif",
    }
)

#: Leading bytes that prove a file is what its `Content-Type` claims. Checking
#: the declared type alone is not a check at all — it is a string the uploader
#: chose. A polyglot (valid JPEG header, HTML/JS body) still passes this, which
#: is why the CDN must also serve with `Content-Type: image/*` and why SVG is
#: not on the allowlist in the first place.
_MAGIC_SIGNATURES: dict[str, tuple[bytes, ...]] = {
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/gif": (b"GIF87a", b"GIF89a"),
    "image/webp": (b"RIFF",),  # + "WEBP" at offset 8 — checked separately
    "image/avif": (b"ftypavif", b"ftypavis", b"ftypmif1", b"ftypheic"),  # at offset 4
}


class StoredObject(BaseModel):
    """What came back from a successful upload (or a metadata lookup)."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    provider: str
    #: The provider's stable identifier for the object. This — not the URL — is
    #: what gets persisted.
    public_id: str
    #: Deliverable URL. May be a bare or a transformed CDN URL.
    url: str
    secure_url: str | None = None
    resource_type: str = "image"
    format: str | None = None
    bytes: int | None = Field(default=None, ge=0)
    width: int | None = Field(default=None, ge=0)
    height: int | None = Field(default=None, ge=0)
    created_at: datetime | None = None
    #: Verbatim provider response. Debug/dispute use; not for API responses.
    raw: dict[str, Any] | None = None


class StorageUploadRequest(BaseModel):
    """Bytes to store, plus the policy constraints for this particular upload."""

    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)

    content: bytes
    filename: str = Field(min_length=1, max_length=255)
    content_type: str | None = None
    #: Sub-folder under the provider's configured root. Sluggified and
    #: length-checked by `StorageProvider.validate_upload`.
    folder: str | None = None
    #: Caller-chosen identifier. If omitted the adapter generates one — a
    #: caller-supplied id must never be trusted to be collision-free or safe.
    public_id: str | None = None
    allowed_mime_types: frozenset[str] = ALLOWED_IMAGE_MIME_TYPES
    max_bytes: int | None = Field(default=None, gt=0)
    #: Refuse to overwrite an existing object. On by default: an upload that
    #: silently replaces someone else's file is a content-swap attack on
    #: anything already displayed or already sold.
    overwrite: bool = False


class StorageProvider(ABC):
    """One external file store."""

    name: ClassVar[str]
    display_name: ClassVar[str] = ""

    #: Set by the adapter's constructor from `Settings`.
    max_upload_bytes: int

    # ─── Contract ───────────────────────────────────────────────────────────

    @abstractmethod
    async def upload(self, request: StorageUploadRequest) -> StoredObject:
        """Store bytes and return their identifier + URL.

        Implementations MUST call `self.validate_upload(request)` before doing
        anything with the content, and MUST return `url`/`secure_url` that
        satisfy `self.is_own_url(...)`.
        """

    @abstractmethod
    async def delete(self, public_id: str, *, resource_type: str = "image") -> bool:
        """Delete by identifier. True if deleted, False if it wasn't there.

        "Wasn't there" is not an error: deletes are retried after partial
        failures (a listing removed after its images were already purged), and
        making that a 502 would turn cleanup into an incident.
        """

    @abstractmethod
    def public_url(
        self, public_id: str, *, resource_type: str = "image", transformation: str | None = None
    ) -> str:
        """Derive a deliverable URL from an identifier. Pure and synchronous.

        Must raise `StorageProviderError` when the provider isn't configured —
        returning a URL built from an empty cloud name would produce a link
        that 404s, or worse, resolves into someone else's namespace.
        """

    @abstractmethod
    def is_own_url(self, url: str) -> bool:
        """True if `url` is served by *this* account, not merely by this vendor.

        The backend equivalent of `isOwnCloudinaryUrl()` in
        `src/lib/validations/upload-security.ts`. A hostname allowlist stops
        arbitrary domains; this stops a URL pointing at a *different customer's*
        bucket on the same vendor, which the hostname check cannot see.
        """

    async def healthcheck(self) -> tuple[bool, float | None]:
        """(usable, latency_ms). Default: usable iff configured.

        An adapter that can check credentials without a billable API call should
        override this. Used by `/api/v1/health/ready` only if storage is on the
        critical path — it currently is not, so a storage outage degrades
        uploads, not the API.
        """
        return self.is_configured, None

    @property
    @abstractmethod
    def is_configured(self) -> bool:
        """Enough configuration present to do anything at all."""

    # ─── Shared policy (implemented once, here) ─────────────────────────────

    def validate_upload(self, request: StorageUploadRequest) -> None:
        """Enforce size, type, magic bytes and folder safety. Raises 422.

        Called by every adapter before it touches the network. The error
        message is intentionally vague: these checks exist to stop someone
        probing them, and "that file was rejected" tells a prober less than
        "the magic bytes did not match the declared Content-Type". The specific
        reason goes to the log.
        """
        content = request.content
        if not content:
            self._reject("empty_file", request, "An empty file was uploaded.")

        ceiling = request.max_bytes or self.max_upload_bytes
        if len(content) > ceiling:
            self._reject(
                "too_large",
                request,
                f"File exceeds the {ceiling // (1024 * 1024)} MB limit.",
                size_bytes=len(content),
                limit_bytes=ceiling,
            )

        declared = (request.content_type or "").split(";")[0].strip().lower()
        if declared and declared not in request.allowed_mime_types:
            self._reject(
                "mime_not_allowed",
                request,
                "That file type is not accepted.",
                declared_type=declared,
                allowed=sorted(request.allowed_mime_types),
            )

        detected = self.sniff_mime_type(content)
        if detected is None:
            self._reject(
                "unrecognized_content", request, "That file type is not accepted.", size_bytes=len(content)
            )
        if detected not in request.allowed_mime_types:
            self._reject(
                "detected_type_not_allowed",
                request,
                "That file type is not accepted.",
                detected_type=detected,
                declared_type=declared or None,
            )
        # The interesting case: a file whose bytes say one thing and whose
        # header says another. Rejecting it is the only safe answer — we cannot
        # know which the downstream consumer will believe.
        if declared and declared != detected:
            self._reject(
                "type_mismatch",
                request,
                "That file type is not accepted.",
                declared_type=declared,
                detected_type=detected,
            )

        # An empty/whitespace folder means "the provider's root folder", not a
        # malformed path — refusing it would make `folder=""` a 422 for callers
        # that build the string conditionally.
        if request.folder and request.folder.strip() and not _SAFE_FOLDER.match(request.folder.strip()):
            self._reject(
                "unsafe_folder",
                request,
                "That upload destination is not valid.",
                folder_length=len(request.folder),
            )

        if request.public_id is not None and not _SAFE_PUBLIC_ID.match(request.public_id):
            self._reject(
                "unsafe_public_id",
                request,
                "That upload destination is not valid.",
                public_id_length=len(request.public_id),
            )

    @staticmethod
    def sniff_mime_type(content: bytes) -> str | None:
        """Identify an image format from its bytes. None if unrecognized.

        Hand-rolled rather than pulling in `python-magic`: that needs libmagic
        on the host, which is a system dependency this project otherwise does
        not have, and the set of formats MaliHub accepts is five entries long.
        """
        if len(content) < 12:
            return None
        if content.startswith(b"\xff\xd8\xff"):
            return "image/jpeg"
        if content.startswith(b"\x89PNG\r\n\x1a\n"):
            return "image/png"
        if content.startswith((b"GIF87a", b"GIF89a")):
            return "image/gif"
        if content.startswith(b"RIFF") and content[8:12] == b"WEBP":
            return "image/webp"
        # ISO-BMFF (AVIF/HEIC): a 4-byte size, then "ftyp", then the brand.
        if content[4:8] == b"ftyp":
            brand = content[8:12]
            if brand in (b"avif", b"avis"):
                return "image/avif"
            # HEIC is a still-image container Apple produces; it is not on the
            # allowlist (browsers other than Safari cannot display it), but
            # identifying it means the mismatch is reported accurately instead
            # of as "unrecognized".
            if brand in (b"heic", b"heix", b"mif1"):
                return "image/heic"
        return None

    def _reject(self, reason: str, request: StorageUploadRequest, message: str, **context: Any) -> None:
        from app.core.logging import get_logger

        # Filename is logged (it is diagnostic and user-chosen, not secret);
        # content never is. Declared/detected types are logged so a wave of
        # mismatches is visible as a pattern.
        # `upload_filename`, not `filename`: the latter is a reserved LogRecord
        # attribute, and passing it in `extra=` makes stdlib logging raise
        # KeyError. A crash in the logging path of an upload-rejection handler
        # would turn a 422 into a 500 — the worst possible place for one.
        get_logger(__name__).warning(
            "storage_upload_rejected",
            extra=safe_extra(
                **{
                    **context,
                    "event": "storage_upload_rejected",
                    "provider": self.name,
                    "reason": reason,
                    "upload_filename": request.filename,
                    "declared_type": request.content_type,
                }
            ),
        )
        raise StorageUploadRejectedError(message, details={"reason": reason})


#: A folder segment: letters, digits, dash, underscore, and `/` as a separator.
#: No `.` — that excludes `..` traversal without needing to special-case it.
#: Each segment is bounded so the whole path is bounded too (6 × 64 + 5
#: separators = 389 chars); an unbounded `+` would accept a megabyte of "a"
#: and pass it straight to the provider's API.
_SAFE_FOLDER = re.compile(r"^[A-Za-z0-9_-]{1,64}(/[A-Za-z0-9_-]{1,64}){0,5}$")
#: A provider object id we generated or accepted. No extension, no dots, no
#: slashes beyond the folder separator.
_SAFE_PUBLIC_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}(/[A-Za-z0-9_-]{1,128}){0,6}$")


__all__ = [
    "ALLOWED_IMAGE_MIME_TYPES",
    "StorageProvider",
    "StorageProviderError",
    "StorageUploadRejectedError",
    "StorageUploadRequest",
    "StoredObject",
]
