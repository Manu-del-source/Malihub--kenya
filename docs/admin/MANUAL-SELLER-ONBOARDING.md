# Manual seller onboarding

MaliHub administrators can create a seller from **Admin → Sellers → Create seller**.

## Production configuration

Set these server-side environment variables on the Next.js deployment (Vercel), using values for the same Neon branch as `NEON_AUTH_BASE_URL`:

- `NEON_API_KEY`, `NEON_PROJECT_ID`, and `NEON_AUTH_BRANCH_ID` are optional. If set, they allow best-effort deletion of the Neon identity if the application database transaction fails. Keep the API key secret; never use a `NEXT_PUBLIC_` prefix.
- `NEXT_PUBLIC_APP_URL`: the canonical MaliHub origin, which must be configured as a trusted redirect domain in Neon Auth.

The feature uses the existing Neon Auth URL and app origin for account creation. Without the optional Management API values, onboarding still works, but an auth identity created just before an application database failure may need manual cleanup in Neon.

## What happens when an admin creates a seller

1. The server validates the seller's name, email, shop name and Kenyan county.
2. The server calls Neon Auth's email sign-up endpoint with a cryptographically random temporary password. The credential is hashed by Neon Auth; the temporary password is never returned, logged or stored by MaliHub.
3. A Prisma transaction creates MaliHub's application user, profile and seller rows, linked by the Neon identity ID.
4. The seller profile starts as `UNVERIFIED`; the account does not receive verified seller privileges automatically.
5. MaliHub sends an email-verification code. The seller verifies at `/verify-email`, then uses **Forgot password** on the sign-in page to choose a password they know. This is required because the production Neon Auth branch requires email verification before sign-in.
6. The admin can resend the verification code from the seller detail screen.

If the application database transaction fails after Neon creates the identity, MaliHub attempts to delete the Neon identity through the Management API to avoid leaving an orphaned auth account. Email delivery is reported separately: a seller record can exist even when Neon does not confirm that the verification code was sent, and the admin can retry from the seller detail screen.

## Security boundaries

- Both create and resend actions independently call `requireAdministratorAction()`.
- Input is validated on the server; no role, verification status, user ID or auth ID is accepted from the browser.
- The Neon API key is used only in a server-only service and is never returned to the client or logged.
- Audit metadata contains IDs and the initial verification status, not passwords, reset tokens or seller contact details.
- Existing seller verification remains a separate admin decision.
