"""CommissionService: precedence, rounding, and the configuration-error path.

No database involved — every `CommissionRule` here is constructed in-memory,
which is the entire point of keeping calculation out of the persistence
layer (see the module docstring in `app/services/commission_service.py`).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone

import pytest
from pydantic import ValidationError as PydanticValidationError

from app.services.commission_service import (
    CommissionConfigurationError,
    CommissionRule,
    CommissionRuleScope,
    CommissionRuleType,
    CommissionService,
)

NOW = datetime(2026, 1, 1, tzinfo=UTC)
EARLIER = NOW - timedelta(days=30)
LATER = NOW + timedelta(days=30)


def default_rule(*, bps: int = 500, effective_from: datetime = EARLIER) -> CommissionRule:
    return CommissionRule(
        id="rule-default",
        scope=CommissionRuleScope.DEFAULT,
        type=CommissionRuleType.PERCENTAGE,
        percentage_bps=bps,
        effective_from=effective_from,
    )


# ─── Percentage commission ───────────────────────────────────────────────────


def test_percentage_commission_on_a_round_amount() -> None:
    service = CommissionService()
    result = service.calculate(
        gross_amount_cents=10_000_00,  # KES 10,000
        seller_id="seller-1",
        category_id=None,
        rules=[default_rule(bps=500)],  # 5.00%
        at=NOW,
    )
    assert result.commission_amount_cents == 500_00  # KES 500
    assert result.net_amount_cents == 9_500_00
    assert result.applied_scope is CommissionRuleScope.DEFAULT


def test_percentage_commission_rounds_half_up() -> None:
    """5.5% of KES 10.51 (1051 cents) = 57.805 cents -> rounds to 58."""
    service = CommissionService()
    result = service.calculate(
        gross_amount_cents=1_051,
        seller_id="seller-1",
        category_id=None,
        rules=[default_rule(bps=550)],
        at=NOW,
    )
    assert result.commission_amount_cents == 58


# ─── Fixed commission ────────────────────────────────────────────────────────


def test_fixed_commission() -> None:
    service = CommissionService()
    rule = CommissionRule(
        id="rule-fixed",
        scope=CommissionRuleScope.DEFAULT,
        type=CommissionRuleType.FIXED,
        fixed_amount_cents=5_000,  # flat KES 50
        effective_from=EARLIER,
    )
    result = service.calculate(
        gross_amount_cents=100_000,
        seller_id="seller-1",
        category_id=None,
        rules=[rule],
        at=NOW,
    )
    assert result.commission_amount_cents == 5_000
    assert result.net_amount_cents == 95_000


def test_fixed_commission_is_clamped_to_the_gross_amount() -> None:
    """A misconfigured flat fee larger than the sale must not produce a
    negative seller payout."""
    service = CommissionService()
    rule = CommissionRule(
        id="rule-fixed-oversized",
        scope=CommissionRuleScope.DEFAULT,
        type=CommissionRuleType.FIXED,
        fixed_amount_cents=50_000,
        effective_from=EARLIER,
    )
    result = service.calculate(
        gross_amount_cents=10_000,
        seller_id="seller-1",
        category_id=None,
        rules=[rule],
        at=NOW,
    )
    assert result.commission_amount_cents == 10_000
    assert result.net_amount_cents == 0


# ─── Precedence: seller > category > default ─────────────────────────────────


def test_seller_specific_rule_beats_category_and_default() -> None:
    service = CommissionService()
    seller_rule = CommissionRule(
        id="rule-seller",
        scope=CommissionRuleScope.SELLER,
        seller_id="seller-1",
        type=CommissionRuleType.PERCENTAGE,
        percentage_bps=200,
        effective_from=EARLIER,
    )
    category_rule = CommissionRule(
        id="rule-category",
        scope=CommissionRuleScope.CATEGORY,
        category_id="cat-1",
        type=CommissionRuleType.PERCENTAGE,
        percentage_bps=800,
        effective_from=EARLIER,
    )
    result = service.calculate(
        gross_amount_cents=10_000_00,
        seller_id="seller-1",
        category_id="cat-1",
        rules=[seller_rule, category_rule, default_rule(bps=500)],
        at=NOW,
    )
    assert result.applied_rule_id == "rule-seller"
    assert result.applied_scope is CommissionRuleScope.SELLER
    assert result.commission_amount_cents == 200_00


def test_category_rule_beats_default_when_no_seller_rule_matches() -> None:
    service = CommissionService()
    category_rule = CommissionRule(
        id="rule-category",
        scope=CommissionRuleScope.CATEGORY,
        category_id="cat-1",
        type=CommissionRuleType.PERCENTAGE,
        percentage_bps=800,
        effective_from=EARLIER,
    )
    result = service.calculate(
        gross_amount_cents=10_000_00,
        seller_id="seller-999",  # no seller-specific rule exists for this seller
        category_id="cat-1",
        rules=[category_rule, default_rule(bps=500)],
        at=NOW,
    )
    assert result.applied_scope is CommissionRuleScope.CATEGORY
    assert result.commission_amount_cents == 800_00


def test_a_seller_rule_for_a_different_seller_does_not_match() -> None:
    service = CommissionService()
    other_sellers_rule = CommissionRule(
        id="rule-seller-2",
        scope=CommissionRuleScope.SELLER,
        seller_id="seller-2",
        type=CommissionRuleType.PERCENTAGE,
        percentage_bps=100,
        effective_from=EARLIER,
    )
    result = service.calculate(
        gross_amount_cents=10_000_00,
        seller_id="seller-1",
        category_id=None,
        rules=[other_sellers_rule, default_rule(bps=500)],
        at=NOW,
    )
    assert result.applied_scope is CommissionRuleScope.DEFAULT


def test_within_one_scope_the_most_recently_effective_rule_wins() -> None:
    """A rate change is a new row, not a mutation — see the module docstring."""
    service = CommissionService()
    old_default = default_rule(bps=1000, effective_from=EARLIER)
    new_default = default_rule(bps=500, effective_from=NOW - timedelta(days=1))
    result = service.calculate(
        gross_amount_cents=10_000_00,
        seller_id="seller-1",
        category_id=None,
        rules=[old_default, new_default],
        at=NOW,
    )
    assert result.commission_amount_cents == 500_00


# ─── Effective windows ────────────────────────────────────────────────────────


def test_an_inactive_rule_is_ignored() -> None:
    service = CommissionService()
    inactive = default_rule(bps=100)
    inactive.is_active = False
    with pytest.raises(CommissionConfigurationError):
        service.calculate(
            gross_amount_cents=1_000,
            seller_id="seller-1",
            category_id=None,
            rules=[inactive],
            at=NOW,
        )


def test_a_rule_not_yet_effective_is_ignored() -> None:
    service = CommissionService()
    future_rule = default_rule(bps=100, effective_from=LATER)
    with pytest.raises(CommissionConfigurationError):
        service.calculate(
            gross_amount_cents=1_000,
            seller_id="seller-1",
            category_id=None,
            rules=[future_rule],
            at=NOW,
        )


def test_a_rule_past_its_effective_to_is_ignored() -> None:
    service = CommissionService()
    rule = default_rule(bps=100)
    rule.effective_to = NOW - timedelta(days=1)
    with pytest.raises(CommissionConfigurationError):
        service.calculate(
            gross_amount_cents=1_000,
            seller_id="seller-1",
            category_id=None,
            rules=[rule],
            at=NOW,
        )


# ─── Zero / invalid values ────────────────────────────────────────────────────


def test_no_applicable_rule_raises_a_configuration_error_not_a_silent_zero() -> None:
    service = CommissionService()
    with pytest.raises(CommissionConfigurationError) as excinfo:
        service.calculate(
            gross_amount_cents=1_000,
            seller_id="seller-1",
            category_id=None,
            rules=[],
            at=NOW,
        )
    assert excinfo.value.status_code == 500
    assert excinfo.value.code == "commission_configuration_error"


def test_zero_or_negative_gross_amount_is_rejected() -> None:
    service = CommissionService()
    for bad_amount in (0, -100):
        with pytest.raises(ValueError):
            service.calculate(
                gross_amount_cents=bad_amount,
                seller_id="seller-1",
                category_id=None,
                rules=[default_rule()],
                at=NOW,
            )


def test_seller_rule_requires_seller_id() -> None:
    with pytest.raises(PydanticValidationError):
        CommissionRule(
            id="bad",
            scope=CommissionRuleScope.SELLER,
            type=CommissionRuleType.PERCENTAGE,
            percentage_bps=100,
            effective_from=EARLIER,
        )


def test_category_rule_requires_category_id() -> None:
    with pytest.raises(PydanticValidationError):
        CommissionRule(
            id="bad",
            scope=CommissionRuleScope.CATEGORY,
            type=CommissionRuleType.PERCENTAGE,
            percentage_bps=100,
            effective_from=EARLIER,
        )


def test_default_rule_must_not_carry_seller_or_category_id() -> None:
    with pytest.raises(PydanticValidationError):
        CommissionRule(
            id="bad",
            scope=CommissionRuleScope.DEFAULT,
            seller_id="seller-1",
            type=CommissionRuleType.PERCENTAGE,
            percentage_bps=100,
            effective_from=EARLIER,
        )


def test_percentage_rule_requires_percentage_bps() -> None:
    with pytest.raises(PydanticValidationError):
        CommissionRule(
            id="bad",
            scope=CommissionRuleScope.DEFAULT,
            type=CommissionRuleType.PERCENTAGE,
            effective_from=EARLIER,
        )


def test_fixed_rule_requires_fixed_amount_cents() -> None:
    with pytest.raises(PydanticValidationError):
        CommissionRule(
            id="bad",
            scope=CommissionRuleScope.DEFAULT,
            type=CommissionRuleType.FIXED,
            effective_from=EARLIER,
        )


def test_percentage_bps_cannot_exceed_10000() -> None:
    """10000 bps = 100%. Anything above that is a data-entry error, not a
    valid "MaliHub takes more than the sale" rule."""
    with pytest.raises(PydanticValidationError):
        CommissionRule(
            id="bad",
            scope=CommissionRuleScope.DEFAULT,
            type=CommissionRuleType.PERCENTAGE,
            percentage_bps=10_001,
            effective_from=EARLIER,
        )


def test_rule_model_rejects_unknown_fields() -> None:
    """Same `extra=\"forbid\"` discipline as the payment contract models in
    `providers/payments/base.py`."""
    with pytest.raises(PydanticValidationError):
        CommissionRule(
            id="bad",
            scope=CommissionRuleScope.DEFAULT,
            type=CommissionRuleType.PERCENTAGE,
            percentage_bps=500,
            effective_from=EARLIER,
            provider_fee_bps=100,  # type: ignore[call-arg]
        )
