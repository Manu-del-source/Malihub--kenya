# Security release notes

## Dependency advisory

`npm audit` reports **one high-severity entry and no critical entries** for
GHSA-mrhx-c7xc-m3w5, an oversized-collection validation issue that can exhaust
memory by producing many validation errors:

| Affected entry | Exposure and mitigation | Remaining fix |
| --- | --- | --- |
| `zod@3.24.1` | Used by application schemas. Listing images and supplier county lists reject oversized arrays **before** validating their elements. This does not limit the size of the HTTP body itself or prove that every possible Zod input is protected. | Upgrade the application and its Zod 3 consumers to a patched release after compatibility testing. Enforce a request-body size limit at the ingress in the meantime. |

The two Cloudinary entries previously inherited the same Zod issue through
`@cloudinary-util/url-loader@5.10.4`. A narrowly scoped override selects
`6.3.2` only for `next-cloudinary@6.16.0`; the newer loader no longer depends
on Zod. This is outside the loader range declared by `next-cloudinary`, and the
loader's non-widget APIs changed. MaliHub currently uses only `CldUploadWidget`.
The widget option, event and signature callbacks were compared across versions,
and regression tests exercise both app upload components with a simulated SDK.
Real listing and chat uploads must still be tested with the staging preset. Do
not adopt other loader APIs without reviewing compatibility; remove the override
when a vendor-supported compatible upgrade is available. `next-cloudinary@7`
requires Next 16 and is not a compatible patch for this Next 15 app.

The Neon Auth SDK's pinned Zod 4 dependency is overridden to `4.6.7` and is no
longer reported by the advisory. The mocked-upstream SDK auth regression tests
pass with that override. The existing SDK/Next 15 and `better-call`/Zod peer
mismatches remain: the project uses `legacy-peer-deps`, so staging auth must
still be verified before release. `npm audit fix --force` is not a safe fix.

## Configuration checks before release

- In the Cloudinary Console, inspect the unsigned preset named by
  `NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET`. Enforce image-only allowed formats,
  an agreed maximum file size, non-overwrite/folder restrictions, and abuse
  limits or monitoring **on the preset/account**, not only in the widget.
  Confirm listing and chat uploads still work. The preset is public by design;
  direct requests bypass browser controls. The actual account configuration
  was not accessible during this review.
- Ensure the CDN, load balancer, reverse proxy, and APM omit or redact the
  **entire query string** for `/api/v1/chat/ws` before logging or tracing it.
  Uvicorn filters ticket values, including encoded parameter names, but cannot
  control upstream logs. Confirm retention/access controls and remove any
  already-logged tickets under the operator's incident procedure.
- Point `DATABASE_URL` and `DIRECT_URL` only at an isolated staging database.
  With genuine Prisma engines available, run `npm ci`, `npx prisma generate`,
  `npx prisma migrate deploy`, the test/lint/type checks, and `npm run build`.
  Exercise buyer and seller sign-in, upload, search, cart, checkout, Paystack
  test payment/webhook, order tracking, and supplier fulfilment with staging
  providers. Do not run these migration steps against production as part of
  this PR.
- Confirm CI and required branch-protection checks in GitHub. Review retention
  and access for server-side raw payment callback payloads.

## Historical CI signing value

A fixed `NEON_AUTH_COOKIE_SECRET` appears only in the historical non-main
`.github/workflows/quality.yml:30` among the reachable repository blobs scanned;
its workflow context is test-only. No production use was confirmed, and the
value is intentionally omitted. Deployment secret stores and provider sessions
were not accessible, so reuse cannot be ruled out.

If reuse cannot be excluded, the owner should:

1. In Vercel **Project → Settings → Environment Variables** (and any other
   affected hosting secret store), replace `NEON_AUTH_COOKIE_SECRET` separately
   for each affected environment with a new, randomly generated secret of at
   least 32 characters. Never paste either value into Git or an issue.
2. After separate deployment approval, redeploy the affected environments so
   every running instance uses the new value; verify sign-in and session reads.
   Rotation invalidates the SDK's signed session-data cache, but **does not by
   itself revoke Neon Auth session tokens**.
3. If session compromise is possible, use the authorized Neon Auth/Better Auth
   session-revocation procedure for affected users (the authenticated
   `revoke-sessions` operation), verify old sessions can no longer be used, and
   review relevant access logs. Coordinate with the Neon project owner if
   administrative bulk revocation is required. No credentials or sessions
   were changed during this review.
