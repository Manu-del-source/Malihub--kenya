"""Provider registry: how the rest of the app gets a `PaymentProvider`.

Callers never import `PayHeroProvider`. They ask the registry for a provider by
name (or accept the configured default) and use it through the
`PaymentProvider` interface. That indirection is the entire point of the
architecture: adding Daraja in a future phase means writing one adapter and
adding one line to `build_default_registry`, and no service, route, schema or
client changes at all.

Two providers are deliberately *not* registered:

* `DARAJA` — reserved in the Prisma enum and in `PaymentProviderName` so that
  adding it later is a code change rather than a destructive enum migration.
  There is no implementation and no request anywhere in this codebase makes a
  Safaricom/Daraja API call. Asking the registry for it produces a clear,
  honest error naming it as planned work.
* `MANUAL` — cash on delivery and similar, settled by hand. There is no
  external processor to talk to, so there is nothing for an adapter to do;
  those payments are recorded directly against the `Payment` row by an
  application service. It is a valid *value* for `payments.provider` and not a
  valid *registry key*.
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator

from app.core.config import Settings, get_settings
from app.core.errors import NotFoundError
from app.core.logging import get_logger
from app.providers.payments.base import (
    PaymentProvider,
    PaymentProviderName,
    ProviderCapability,
)
from app.providers.payments.payhero import PayHeroProvider

logger = get_logger(__name__)

#: Registered adapters. Add new providers here and nowhere else.
_PROVIDERS: dict[PaymentProviderName, type[PaymentProvider]] = {
    PaymentProviderName.PAYHERO: PayHeroProvider,
}

#: Provider enum values that exist in the schema but have no adapter, with the
#: reason. Public and surfaced by `GET /api/v1/payments/providers` so "unknown
#: provider" and "known but not built yet" are distinguishable — they need
#: different responses from whoever hits them. Reasons are static prose written
#: for developers and contain no configuration state.
RESERVED_PROVIDERS: dict[PaymentProviderName, str] = {
    PaymentProviderName.DARAJA: (
        "Daraja (direct Safaricom M-Pesa) is a planned future provider. It is "
        "reserved in the schema but has no implementation, and no request in "
        "this codebase calls a Safaricom API."
    ),
    PaymentProviderName.MANUAL: (
        "MANUAL payments are settled offline and recorded directly against the "
        "Payment row; there is no external processor, so there is no adapter."
    ),
}


class PaymentProviderRegistry:
    """Immutable once built. One instance per process."""

    def __init__(self, providers: Iterable[PaymentProvider]) -> None:
        self._providers: dict[PaymentProviderName, PaymentProvider] = {}
        for provider in providers:
            # Last registration wins would hide a mistake; a duplicate key means
            # two adapters claim the same provider, which is a bug at startup.
            if provider.name in self._providers:
                raise ValueError(f"Duplicate payment provider registration for {provider.name.value}")
            self._providers[provider.name] = provider

    def __contains__(self, name: object) -> bool:
        return name in self._providers

    def __iter__(self) -> Iterator[PaymentProvider]:
        return iter(self._providers.values())

    def __len__(self) -> int:
        return len(self._providers)

    @property
    def registered(self) -> tuple[PaymentProviderName, ...]:
        return tuple(self._providers)

    def get(self, name: PaymentProviderName | str) -> PaymentProvider | None:
        """The adapter for `name`, or None if there isn't one."""
        resolved = _coerce(name)
        return self._providers.get(resolved) if resolved is not None else None

    def resolve(
        self, name: PaymentProviderName | str | None = None, *, settings: Settings | None = None
    ) -> PaymentProvider:
        """The adapter for `name`, or the configured default. Raises if unknown.

        `NotFoundError` (404) rather than a 400 for an unregistered provider:
        from a client's point of view `/payments/providers/{name}` is a resource
        that does not exist, and the body explains whether it is unknown or
        merely not built yet.
        """
        resolved_settings = settings or get_settings()
        if name is None:
            name = resolved_settings.payments_default_provider

        coerced = _coerce(name)
        if coerced is None:
            raise NotFoundError(
                f"Unknown payment provider {str(name)!r}.",
                details={
                    "registered": [candidate.value for candidate in self.registered],
                    "reserved": [candidate.value for candidate in RESERVED_PROVIDERS],
                },
            )

        provider = self._providers.get(coerced)
        if provider is None:
            raise NotFoundError(
                f"The {coerced.value} payment provider is not available.",
                details={
                    "provider": coerced.value,
                    "reason": RESERVED_PROVIDERS.get(coerced, "No adapter is registered for this provider."),
                    "registered": [candidate.value for candidate in self.registered],
                },
            )
        return provider

    def capabilities(self) -> list[ProviderCapability]:
        """Every registered provider's public, non-secret description."""
        return [provider.capability() for provider in self._providers.values()]


def _coerce(name: PaymentProviderName | str | None) -> PaymentProviderName | None:
    """Accept either enum case. Providers are referred to inconsistently
    (`payhero` in a URL path, `PAYHERO` in the database), and rejecting one of
    them would be a pointless source of 404s."""
    if name is None:
        return None
    if isinstance(name, PaymentProviderName):
        return name
    try:
        return PaymentProviderName(str(name).strip().upper())
    except ValueError:
        return None


def build_default_registry(settings: Settings | None = None) -> PaymentProviderRegistry:
    """Construct every registered adapter from configuration.

    Called once at startup. An adapter that cannot be constructed (a bad config
    value) fails here, loudly, rather than on the first customer's payment.
    """
    resolved = settings or get_settings()
    providers: list[PaymentProvider] = []
    for name, adapter_class in _PROVIDERS.items():
        try:
            providers.append(adapter_class(resolved))
        except Exception as exc:
            # Type only — a config-parsing exception message can quote the bad
            # value, which for a credential is the value itself.
            logger.error(
                "payment_provider_init_failed",
                extra={
                    "event": "payment_provider_init_failed",
                    "provider": name.value,
                    "error_type": type(exc).__name__,
                },
            )
            raise
    registry = PaymentProviderRegistry(providers)
    logger.info(
        "payment_providers_registered",
        extra={
            "event": "payment_providers_registered",
            "registered": [provider.name.value for provider in registry],
            "reserved": [name.value for name in RESERVED_PROVIDERS],
        },
    )
    return registry


_registry: PaymentProviderRegistry | None = None


def get_payment_registry() -> PaymentProviderRegistry:
    """Process-wide registry singleton."""
    global _registry
    if _registry is None:
        _registry = build_default_registry()
    return _registry


def reset_payment_registry() -> None:
    """Drop the singleton. For tests that change settings between cases."""
    global _registry
    _registry = None


__all__ = [
    "RESERVED_PROVIDERS",
    "PaymentProviderRegistry",
    "build_default_registry",
    "get_payment_registry",
    "reset_payment_registry",
]
