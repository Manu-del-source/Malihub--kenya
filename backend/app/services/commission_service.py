"""CommissionService — MaliHub's cut of a settlement, computed, never hard-coded.

    SettlementService (not yet built)
          │
          ▼
    CommissionService  ← this module
          │
          ▼
    CommissionRule rows (prisma/schema.prisma) — loaded by the caller

Phase 9 brief §10 (both drafts) is explicit: no `commission = 10%` anywhere in
this codebase. This module is where "how much does MaliHub keep" lives, and
it is the *only* place — a route or the settlement service asks this service
for a number, they never compute a percentage themselves.

Design decisions worth stating up front:

* **Rules are basis points, not floats.** `percentage_bps=500` means 5.00%.
  An integer avoids the float-rounding trap the whole codebase already avoids
  for money (`amount_cents`, never a decimal KES float) — see the comment at
  the top of `prisma/schema.prisma`.
* **This service does not query the database.** It receives already-loaded
  `CommissionRule` rows and picks among them. Keeping persistence out of a
  pure calculation makes the precedence logic trivially unit-testable without
  a database — see `tests/test_commission_service.py`. The caller (the
  settlement service) is responsible for loading active rules for a seller
  and its product's category.
* **Precedence is centralized here, not left to whichever rule a query
  returns first.** SELLER beats CATEGORY beats DEFAULT. Within one scope,
  the rule with the latest `effective_from` wins — this is what lets an
  admin schedule a rate change ("new default rate starting Monday") by
  inserting a new row rather than mutating one in place, matching the
  audit-friendly pattern the rest of this codebase already uses for money
  (Payment retries are new rows, not mutations — see `Payment.retryCount`'s
  comment).
* **A commission can never exceed the gross amount, and never goes negative.**
  A misconfigured fixed-fee rule (e.g. KES 500 flat on a KES 200 sale) is
  clamped, not allowed to produce a negative seller payout.
* **No matching rule is a configuration error, not a silent 0%.** A
  marketplace with no active DEFAULT rule is not "commission-free by design"
  — it is unconfigured, and pretending otherwise would quietly cost MaliHub
  its revenue on every order until someone notices.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime, timezone
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.core.errors import ApiError


class CommissionRuleScope(StrEnum):
    """Mirrors the Prisma `CommissionRuleScope` enum character-for-character,
    same rule as `PaymentProviderName` in `providers/payments/base.py`."""

    DEFAULT = "DEFAULT"
    SELLER = "SELLER"
    CATEGORY = "CATEGORY"


class CommissionRuleType(StrEnum):
    PERCENTAGE = "PERCENTAGE"
    FIXED = "FIXED"


class CommissionConfigurationError(ApiError):
    """No applicable rule could be resolved for this calculation.

    A 500, not a 4xx: the caller supplied a valid request, but the platform's
    own commission configuration is incomplete (typically: no active DEFAULT
    rule exists). This must never be papered over with an implicit 0%.
    """

    status_code = 500
    code = "commission_configuration_error"
    default_message = (
        "No active commission rule could be resolved for this order. "
        "This is a platform configuration gap, not a buyer- or seller-caused error."
    )
    user_facing = False


class CommissionRule(BaseModel):
    """A loaded `CommissionRule` row. This is a read model — the service
    never writes one back; creating/editing rules is the settlement/admin
    API's job, not this calculator's.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    id: str
    scope: CommissionRuleScope = CommissionRuleScope.DEFAULT
    seller_id: str | None = None
    category_id: str | None = None
    type: CommissionRuleType
    percentage_bps: int | None = Field(default=None, ge=0, le=10_000)
    fixed_amount_cents: int | None = Field(default=None, ge=0)
    is_active: bool = True
    effective_from: datetime
    effective_to: datetime | None = None

    @model_validator(mode="after")
    def _scope_and_type_are_consistent(self) -> CommissionRule:
        if self.scope is CommissionRuleScope.SELLER and not self.seller_id:
            raise ValueError("A SELLER-scoped rule requires seller_id.")
        if self.scope is CommissionRuleScope.CATEGORY and not self.category_id:
            raise ValueError("A CATEGORY-scoped rule requires category_id.")
        if self.scope is CommissionRuleScope.DEFAULT and (self.seller_id or self.category_id):
            raise ValueError("A DEFAULT-scoped rule must not carry seller_id/category_id.")
        if self.type is CommissionRuleType.PERCENTAGE and self.percentage_bps is None:
            raise ValueError("A PERCENTAGE rule requires percentage_bps.")
        if self.type is CommissionRuleType.FIXED and self.fixed_amount_cents is None:
            raise ValueError("A FIXED rule requires fixed_amount_cents.")
        return self

    def is_effective_at(self, moment: datetime) -> bool:
        if not self.is_active:
            return False
        if moment < self.effective_from:
            return False
        return self.effective_to is None or moment < self.effective_to


class CommissionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    gross_amount_cents: int
    commission_amount_cents: int
    net_amount_cents: int
    applied_rule_id: str
    applied_scope: CommissionRuleScope


class CommissionService:
    """Stateless. Constructed once, called with already-loaded rules."""

    def calculate(
        self,
        *,
        gross_amount_cents: int,
        seller_id: str,
        category_id: str | None,
        rules: Sequence[CommissionRule],
        at: datetime | None = None,
    ) -> CommissionResult:
        if gross_amount_cents <= 0:
            raise ValueError("gross_amount_cents must be positive.")

        moment = at or datetime.now(UTC)
        rule = self._resolve_rule(seller_id=seller_id, category_id=category_id, rules=rules, at=moment)

        commission = self._apply(rule, gross_amount_cents)
        # Clamp: a misconfigured rule (e.g. a flat fee larger than the sale)
        # must never produce a negative seller payout.
        commission = max(0, min(commission, gross_amount_cents))

        return CommissionResult(
            gross_amount_cents=gross_amount_cents,
            commission_amount_cents=commission,
            net_amount_cents=gross_amount_cents - commission,
            applied_rule_id=rule.id,
            applied_scope=rule.scope,
        )

    # ─── Precedence ─────────────────────────────────────────────────────────

    def _resolve_rule(
        self,
        *,
        seller_id: str,
        category_id: str | None,
        rules: Sequence[CommissionRule],
        at: datetime,
    ) -> CommissionRule:
        effective = [rule for rule in rules if rule.is_effective_at(at)]

        seller_rules = [
            r for r in effective if r.scope is CommissionRuleScope.SELLER and r.seller_id == seller_id
        ]
        if seller_rules:
            return self._latest(seller_rules)

        if category_id is not None:
            category_rules = [
                r
                for r in effective
                if r.scope is CommissionRuleScope.CATEGORY and r.category_id == category_id
            ]
            if category_rules:
                return self._latest(category_rules)

        default_rules = [r for r in effective if r.scope is CommissionRuleScope.DEFAULT]
        if default_rules:
            return self._latest(default_rules)

        raise CommissionConfigurationError(
            details={
                "seller_id": seller_id,
                "category_id": category_id,
                "reason": "No active SELLER, CATEGORY, or DEFAULT commission rule is effective at this time.",
            }
        )

    @staticmethod
    def _latest(rules: Sequence[CommissionRule]) -> CommissionRule:
        """Most recently effective wins within one scope — see the module
        docstring on why this, rather than an error, is how a rate change is
        expressed."""
        return max(rules, key=lambda rule: rule.effective_from)

    # ─── Calculation ────────────────────────────────────────────────────────

    @staticmethod
    def _apply(rule: CommissionRule, gross_amount_cents: int) -> int:
        if rule.type is CommissionRuleType.FIXED:
            if rule.fixed_amount_cents is None:
                # The model validator guarantees this can't happen for a rule
                # that passed construction; a raised error here (not an
                # `assert`, which app code never uses — see the ruff S101
                # rationale in pyproject.toml) still fails loudly if it ever
                # does, rather than silently returning a wrong commission.
                raise CommissionConfigurationError(
                    details={"rule_id": rule.id, "reason": "FIXED rule is missing fixed_amount_cents."}
                )
            return rule.fixed_amount_cents

        if rule.percentage_bps is None:
            raise CommissionConfigurationError(
                details={"rule_id": rule.id, "reason": "PERCENTAGE rule is missing percentage_bps."}
            )
        # Round-half-up on integer cents: (gross * bps + 5000) // 10000.
        # Half-up, not banker's rounding — a commission schedule should be
        # boring and reproducible by hand, not depend on which cent value is
        # "even". Add 5000 (= 10000/2) before the integer division.
        return (gross_amount_cents * rule.percentage_bps + 5_000) // 10_000


__all__ = [
    "CommissionConfigurationError",
    "CommissionResult",
    "CommissionRule",
    "CommissionRuleScope",
    "CommissionRuleType",
    "CommissionService",
]
