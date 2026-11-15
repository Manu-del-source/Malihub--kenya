# Admin revenue dashboard (`/admin/reports`)

Read-only. Writes nothing to payments, refunds, settlements, payouts or commission rules.

## Source of truth
- Sales: one SUCCESS `Payment` per order (earliest `paidAt`); extra SUCCESS rows are warned about, never summed. A provider transaction id is counted once.
- Merchandise: `Σ OrderItem.unitPriceCents × quantity`. Delivery fees are never included.
- Commission: configured `CommissionRule` rows only, using the same precedence and rounding as `backend/app/services/commission_service.py` (SELLER > CATEGORY > DEFAULT; latest `effectiveFrom`; half-up basis points; FIXED clamped). **No rate is hardcoded.** With no applicable rule the order is flagged and excluded from commission — never treated as 0%.
- Refunds: `Refund` rows with status COMPLETED.
- Provider fees: `Settlement.providerFeeCents` when recorded; otherwise "not recorded". Never estimated, never deducted.

## Date basis
Orders are dated by successful payment time in Kenya time (UTC+3). Earned vs pending then depends on the order's current status.

## Metrics
| Metric | Definition |
|---|---|
| Gross merchandise sales | merchandise of paid orders (PAID/SHIPPED/DELIVERED/COMPLETED/REFUNDED) |
| Completed merchandise sales | merchandise of COMPLETED orders |
| Commission earned | commission on COMPLETED orders, before reversals |
| Pending commission | commission on PAID/SHIPPED/DELIVERED orders, net of refund reversals |
| Seller earnings payable | merchandise − commission on COMPLETED orders, net of refunds (payouts are not subtracted; the payout phase is separate) |
| Refunds / reversals | completed refund cash / commission reversed (proportional, half-up; full refund reverses all) |
| Net platform revenue | earned commission − reversals on completed orders |
| Payment processing fees | actual recorded provider fees, shown separately |
| Average order value | gross merchandise ÷ paid orders |
| Delivery charges | reported separately; not MaliHub revenue |

## Known limits
- `SettlementService` is not built yet, so `Settlement` rows may not exist; the dashboard does not depend on them (except for provider fees).
- Seller payable is a reporting calculation, not an available wallet balance or withdrawal instruction. No seller payout is initiated or recorded by this dashboard. During the interim operating phase, close seller statements weekly at 23:59 EAT Sunday and target manual payment on the following Tuesday, subject to eligibility and settled-funds checks. An authorised administrator pays manually and keeps a separate auditable record linking statement, seller, orders, deductions, amount, payment reference/proof, operator and status. If a check is outstanding, roll the amount forward and communicate why.
- Paystack's Kenya T+2 collection settlement is to MaliHub's configured merchant payout account. It is not the seller payout date. Seller eligibility follows the order completion/dispute policy and confirmed availability of settled funds. Tuesday is a manual payout target after the Sunday statement cutoff, not a guarantee; late-settling or disputed amounts roll forward. There is no automated seller withdrawal or transfer lifecycle.
- A `Refund` does not itemise delivery, so refunds are applied to merchandise first (conservative).
- A FIXED rule applies once per rule group per order.
- Order status `REFUNDED` is reserved (no transition sets it); refunds normally arrive as `Refund` rows.
