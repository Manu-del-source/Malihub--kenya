# MaliHub Cloudinary upload guardrails

## Limits implemented

- Seller product uploader: up to 5 images per product, 1 MB per image, JPEG/PNG/WebP only, maximum 2,000 × 2,000 pixels in the widget.
- Verified sellers: up to 30 product-image signature requests per rolling 24 hours.
- Signed-in users' chat attachments: up to 20 message-image signature requests per rolling 24 hours, with the same file limits.
- Upload signing requires a valid session and Upstash Redis. The signing route fails closed if Redis or the Cloudinary usage check is unavailable.
- Cloudinary usage is cached for 60 seconds. At 70% of the account's credits, the server logs a warning and the admin usage endpoint reports `warning: true`. At 85%, new signed uploads are paused.
- `CLOUDINARY_UPLOADS_PAUSED=true` is an emergency server-side switch to stop new signed uploads.
- `GET /api/admin/cloudinary-usage` returns current usage to ADMIN/SUPER_ADMIN users. Add `?refresh=1` to bypass the 60-second cache.

## Required deployment configuration

In the **Vercel environment for the preview first**, configure:

- `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`
- `NEXT_PUBLIC_CLOUDINARY_API_KEY` — the Cloudinary API key is public; it is not the API secret.
- `NEXT_PUBLIC_CLOUDINARY_SIGNED_UPLOAD_PRESET` — the name of the signed preset created for MaliHub image uploads.
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET` — server-only; never prefix it with `NEXT_PUBLIC_`.
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `CLOUDINARY_UPLOADS_PAUSED=false`

The public and server-side API key values should match. Keep the API secret private. The new upload preset must be configured as **Signed**; do not point this variable at the old unsigned preset.

## Critical Cloudinary Console step

MaliHub's former listing and chat widgets used the unsigned `NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET` preset. The code now uses signed uploads, but an unsigned preset can still be abused directly if it remains enabled.

1. Deploy this branch to a **preview** with the environment variables above.
2. Test a verified seller upload and a chat attachment; confirm both succeed and assets land under `malihub/products` and `malihub/messages`.
3. Confirm `GET /api/admin/cloudinary-usage` works as an administrator and returns a numeric credit-usage percentage.
4. Only after those tests pass, go to Cloudinary Console → Settings → Upload → Upload presets and disable/delete the old unsigned preset, if no other feature still depends on it. Search every deployed frontend before removing it.
5. Re-test both upload flows after disabling the preset.

Do not disable the old unsigned preset before preview verification: other deployments or older clients may still depend on it.

## Operational caveats

- The daily quotas limit requests for upload signatures. A signed signature is short-lived, but this is not a billing guarantee against every possible replay or simultaneous request. Keep the Cloudinary console usage page and account alerts enabled.
- Usage-based blocking relies on Cloudinary's Admin API returning credit usage and limit values. If the API cannot be checked or the expected metrics are missing, uploads fail closed rather than risk silently exhausting the allowance.
- The usage endpoint exposes provider usage details only to administrators. It is an API endpoint, not a new dashboard page.
- Removing an image from a listing form does not automatically delete the Cloudinary asset; orphaned-asset cleanup remains a separate task.
- The image count validator continues to accept up to 8 images for backward compatibility with existing listings, while the normal seller uploader allows 5 new images per product. Review existing listings before lowering the database/API validation limit globally.
