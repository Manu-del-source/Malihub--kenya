# Manual seller onboarding

MaliHub administrators can create a seller from **Admin → Sellers → Create seller**.

## Required production configuration

Set these server-side environment variables on the Next.js deployment (Vercel), using values for the same Neon branch as `NEON_AUTH_BASE_URL`:

- `NEON_API_KEY`: a Neon Management API key. Keep it secret; never use a `NEXT_PUBLIC_` prefix.
- `NEON_PROJECT_ID`: the Neon project containing the active Managed Auth integration.
- `NEON_AUTH_BRANCH_ID`: the branch ID for that Managed Auth integration.
- `NEXT_PUBLIC_APP_URL`: the canonical MaliHub origin, which must be configured as a trusted redirect domain in Neon Auth.

The feature fails closed when the three Neon Management API variables are missing. It does not attempt to create an application-only user that cannot authenticate.

## What happens when an admin creates a seller

1. The server validates the seller's name, email, shop name and Kenyan county.
2. The server creates the identity through Neon Management API. MaliHub does not create or store a password.
3. A Prisma transaction creates MaliHub's application user, profile and seller rows, linked by the Neon identity ID.
4. The seller profile starts as `UNVERIFIED`; the account does not receive verified seller privileges automatically.
5. MaliHub requests a password-reset/setup email using the existing Neon Auth flow. The seller chooses their own password.
6. The admin can resend the setup email from the seller detail screen.

If the application database transaction fails after Neon creates the identity, MaliHub attempts to delete the Neon identity to avoid leaving an orphaned auth account. Email delivery is reported separately: a seller record can exist even when Neon does not confirm that the email was sent, and the admin can retry from the seller detail screen.

## Security boundaries

- Both create and resend actions independently call `requireAdministratorAction()`.
- Input is validated on the server; no role, verification status, user ID or auth ID is accepted from the browser.
- The Neon API key is used only in a server-only service and is never returned to the client or logged.
- Audit metadata contains IDs and the initial verification status, not passwords, reset tokens or seller contact details.
- Existing seller verification remains a separate admin decision.
