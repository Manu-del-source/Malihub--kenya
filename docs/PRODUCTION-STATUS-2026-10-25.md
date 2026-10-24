# MaliHub production status — 2026-10-25

This is an operational snapshot of the MaliHub production-domain and checkout
work completed on 2026-10-24/25. It supplements (and does not replace) the
architecture, payment integration, buyer-protection, and launch documents.

## Confirmed by the operator

- The production domain is **https://www.malihubke.online/**.
- The apex domain **https://malihubke.online/** is configured to redirect to the
  canonical `www` hostname.
- The domain migration source changes were merged in PR #52
  (`5c47159f838b1e58deed774baa59de74d746b0aa`).
- The cart's same-origin check initially rejected requests because
  `NEXT_PUBLIC_APP_URL` did not match the new host. Production
  `NEXT_PUBLIC_APP_URL` was corrected to
  `https://www.malihubke.online`, and the frontend was redeployed. The
  operator then confirmed that adding items to the cart works.
- The operator has now confirmed that Paystack checkout works on the new site.
  This confirms the checkout entry flow, but should not be treated by itself
  as proof that webhook settlement, duplicate-event handling, and every order
  state have all been independently audited.
- The operator reported updating the Paystack dashboard URLs and Neon Auth's
  allowed/trusted domains for the new domain.

## Production configuration reference

Keep these settings aligned when changing domains:

| Setting | Expected value / purpose |
| --- | --- |
| Canonical storefront | `https://www.malihubke.online` |
| `NEXT_PUBLIC_APP_URL` (Vercel Production) | `https://www.malihubke.online` — must match the browser origin used by same-origin/CSRF checks |
| Paystack callback / return URL | `https://www.malihubke.online/checkout/payment-result` |
| Paystack webhook URL | `https://www.malihubke.online/api/payments/paystack/webhook` |
| Render backend | `https://malihub-kenya.onrender.com` |
| Render `CORS_ORIGINS` | `https://malihubke.online,https://www.malihubke.online,https://malihub.smartbiz365.site,https://malihub.co.ke,https://malihub-kenya.vercel.app` |
| Auth trusted domains | Include both `malihubke.online` and `www.malihubke.online` in the Neon Auth configuration |

The Paystack callback and webhook settings are separate: the callback sends the
customer's browser back to the payment-result page; the webhook is a server-to-
server notification endpoint. Prefer the canonical `www` host for both. In
particular, configure the webhook directly on the canonical host so a POST
notification does not depend on an apex-to-`www` redirect.

Do not put secret keys, database URLs, tokens, or credentials in documentation
or commit them to the repository. Environment values above are hostnames and
non-secret configuration only.

## Payment architecture and operational checks

Paystack buyer payment collection is implemented in the **Next.js application**,
not by a payment adapter in the Render FastAPI service:

- Initialize hosted checkout: `POST /api/payments/paystack/initialize`
- Paystack webhook: `POST /api/payments/paystack/webhook`
- Server-side verification: `GET/POST /api/payments/paystack/verify`
- Buyer return page: `/checkout/payment-result`

The webhook must verify Paystack's signature against the raw request body.
Payment settlement must remain server-authoritative and idempotent; do not
mark an order paid solely because the browser returned to the callback page.
The existing implementation also checks transaction ownership, amount/currency,
and duplicate/replay conditions. Refer to the implementation and
`docs/PAYSTACK-INTEGRATION-PLAN.md` for code-level details.

A Render log showing `payment_providers=[]` is expected under the current
architecture: the FastAPI payment-provider registry does not process Paystack
checkout. Do not attempt to fix that log by adding Paystack secrets to Render
unless the architecture is deliberately changed.

## Outstanding verification checklist

These checks were not all confirmed by the domain/cart/checkout smoke test.
Complete them before treating the entire production flow as fully verified.

- [ ] In the Paystack dashboard, confirm a real test/live-mode webhook delivery
      reaches `/api/payments/paystack/webhook` and receives a successful 2xx
      response in the correct environment.
- [ ] Confirm the application verifies the transaction server-side and the
      matching order/payment reaches the correct final state.
- [ ] Check that refreshing the return page or receiving a repeated webhook
      does not create a duplicate order, payment, or fulfillment action.
- [ ] Verify failed, abandoned, pending, and successful payments display honest
      statuses and do not mark unpaid orders as paid.
- [ ] Re-test login/session behavior on both the canonical host and any
      supported redirect entry point after the domain change.
- [ ] Smoke-test seller dashboard access and seller-owned listing management.
- [ ] Continue the delivery and buyer-protection checks: courier tracking,
      delivery confirmation, inspection period, and dispute pause/review flow.
- [ ] Test checkout and cart usability at mobile viewport sizes.
- [ ] Investigate recurring Render backend warnings
      `chat_realtime_pump_failed` / `TimeoutError`; confirm chat still works
      and whether the timeout is transient or needs a fix.

## Deployment and change-control notes

- Domain-source migration PR: #52, merged to `main`.
- The production environment correction for `NEXT_PUBLIC_APP_URL` and the
  associated redeploy were applied to restore cart same-origin checks.
- Render `CORS_ORIGINS` was updated to include the new apex and canonical
  domains while retaining the previously listed compatibility domains.
- Neon Auth's allowed/trusted domain list was reported updated by the operator.
- Keep future code changes on a separate branch and PR. Do not make additional
  production configuration changes unless a specific verification failure
  requires them; inspect the failure first.

## Official Paystack references

- [Setting up a callback URL](https://support.paystack.com/en/articles/2129538)
- [API keys and webhooks](https://support.paystack.com/en/articles/2123458)
- [Paystack webhook documentation](https://docs-v2.paystack.com/payments/webhooks/)
- [Viewing and retrying webhook deliveries](https://support.paystack.com/en/articles/10609026)
