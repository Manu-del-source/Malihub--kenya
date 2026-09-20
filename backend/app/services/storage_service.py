"""StorageService — the app's single entry point to external file storage.

    caller  ──▶  StorageService  ──▶  StorageProvider  ──▶  CloudinaryStorageProvider

Same shape as `PaymentService`, same reason: nothing outside this file imports
a vendor class, so swapping Cloudinary for S3, Uploadcare or a self-hosted
MinIO is one adapter plus one config change.

**Never Supabase Storage.** Supabase is MaliHub's authentication provider only;
user files are application data and live with the rest of it, in a store the
application controls. See ARCHITECTURE.md §10a for the one legacy exception
(profile avatars uploaded by the Phase 4 onboarding flow) and why it isn't
extended.

Phase 8 status: URL derivation and ownership validation work and are tested;
byte transfer is a 501 stub, because nothing in the application currently
uploads server-side — the browser uploads directly to Cloudinary through
`next-cloudinary`'s unsigned widget. See `providers/storage/cloudinary.py`.
"""

from __future__ import annotations

from app.core.config import Settings, get_settings
from app.core.errors import NotFoundError
from app.core.logging import get_logger
from app.providers.storage.base import StorageProvider, StorageUploadRequest, StoredObject
from app.providers.storage.cloudinary import CloudinaryStorageProvider

logger = get_logger(__name__)

_ADAPTERS: dict[str, type[StorageProvider]] = {
    CloudinaryStorageProvider.name: CloudinaryStorageProvider,
}


class StorageService:
    """Resolves the configured storage provider and delegates to it."""

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._provider: StorageProvider | None = None

    @property
    def provider_name(self) -> str:
        return self._settings.storage_provider

    @property
    def provider(self) -> StorageProvider:
        """The configured adapter. Constructed once, on first use.

        `storage_provider = "none"` resolves to nothing and raises: a caller
        asking to store a file when storage is disabled should get a clear
        error, not a silent no-op that loses the bytes.
        """
        if self._provider is not None:
            return self._provider

        name = self.provider_name
        if name == "none":
            raise NotFoundError(
                "File storage is not configured on this deployment.",
                details={"storage_provider": name},
            )
        adapter_class = _ADAPTERS.get(name)
        if adapter_class is None:
            raise NotFoundError(
                f"Unknown storage provider {name!r}.",
                details={"known": sorted(_ADAPTERS)},
            )
        self._provider = adapter_class(self._settings)
        return self._provider

    # ─── Delegation ─────────────────────────────────────────────────────────

    async def upload(self, request: StorageUploadRequest) -> StoredObject:
        """Store bytes. Enforces upload policy before any provider call."""
        provider = self.provider
        # Belt and braces: the adapter calls this too, and the base-class
        # implementation is idempotent. Validating at the service boundary
        # means a future adapter that forgets cannot ship an unvalidated path.
        provider.validate_upload(request)
        return await provider.upload(request)

    async def delete(self, public_id: str, *, resource_type: str = "image") -> bool:
        return await self.provider.delete(public_id, resource_type=resource_type)

    def public_url(
        self,
        public_id: str,
        *,
        resource_type: str = "image",
        transformation: str | None = None,
    ) -> str:
        return self.provider.public_url(public_id, resource_type=resource_type, transformation=transformation)

    def is_own_url(self, url: str) -> bool:
        """True if `url` is an asset in *our* storage account.

        Use this to validate any externally-supplied image URL before it is
        persisted — the same check `isOwnCloudinaryUrl()` performs on the
        frontend. Without it, a hostname allowlist (`next.config.ts` permits
        `res.cloudinary.com`) still lets someone reference another Cloudinary
        customer's file, and MaliHub ends up serving it.
        """
        return self.provider.is_own_url(url)

    async def healthcheck(self) -> tuple[bool, float | None]:
        if self.provider_name == "none":
            return False, None
        return await self.provider.healthcheck()


_service: StorageService | None = None


def get_storage_service() -> StorageService:
    """Process-wide singleton, and the FastAPI dependency for storage routes."""
    global _service
    if _service is None:
        _service = StorageService()
    return _service


def reset_storage_service() -> None:
    global _service
    _service = None


__all__ = ["StorageService", "get_storage_service", "reset_storage_service"]
