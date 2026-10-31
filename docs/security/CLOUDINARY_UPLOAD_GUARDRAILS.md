# MaliHub image-upload security

## Upload architecture

All new product, chat and avatar images pass through MaliHub's authenticated server-side upload handlers:

- Product and chat images: `POST /api/uploads/images`
- Profile avatars: `POST /api/avatar/upload`

The browser never receives Cloudinary signing authority and never uploads directly to Cloudinary. Product/chat files are sent to the Next.js upload route as multipart form data; avatars use their own route. The former `POST /api/cloudinary/sign` endpoint returns HTTP 410 and cannot issue signatures. No unsigned upload preset is required by these routes.

## Validation and sanitization

The server:

1. Requires an authenticated session and same-origin request.
2. Enforces the file-size limit and accepted image formats (JPEG, PNG and WebP).
3. Checks the file's magic bytes and requires the declared MIME type to match.
4. Fully decodes the image with Sharp/libvips, with a strict pixel limit.
5. Rejects malformed, truncated, animated/multi-frame and over-dimension images.
6. Applies EXIF orientation and re-encodes the decoded pixels as WebP. Source metadata and appended payload bytes are not copied.
7. Uploads only the sanitized WebP to a fixed server-selected Cloudinary folder with a random public ID, `resource_type=image`, `allowed_formats=[webp]` and `overwrite=false`.

This is image-content sanitization, not an antivirus scanner. MaliHub currently accepts raster images only; it does not accept arbitrary documents, archives, SVG, HTML, scripts or executables through these upload routes.

## Limits and abuse controls

- Product photos: maximum 1 MB input, 2,000 × 2,000 pixels, up to 5 images per product in the seller UI.
- Chat attachments: maximum 1 MB input, 2,000 × 2,000 pixels, one image per upload.
- Profile avatars: maximum 3 MB input, 2,000 × 2,000 pixels.
- Verified sellers: 30 product-image uploads per rolling 24 hours.
- Signed-in users: 20 chat-image uploads per rolling 24 hours.
- Profile avatars: 10 uploads per hour per user.
- **Product/chat route:** requires Upstash Redis to be configured; it returns 503 before processing an upload if Redis is unavailable. It also checks Cloudinary account usage before upload. That usage check requires Redis and valid Cloudinary Admin API credentials; if it cannot verify usage, product/chat uploads fail closed.
- **Avatar route:** its 10-per-hour limiter uses the shared rate-limit helper, which currently fails open when Redis is unavailable. The avatar route does not call the Cloudinary usage guard and does not honor `CLOUDINARY_UPLOADS_PAUSED`. This is a known protection gap, not a guarantee of avatar upload blocking.
- The Cloudinary usage guard warns at 70% and blocks new **product/chat** uploads at 85%. The emergency `CLOUDINARY_UPLOADS_PAUSED=true` switch also pauses **product/chat** uploads only; it does not currently pause avatars.
- Product and chat limits are rolling windows: 30 product images per verified seller per 24 hours, and 20 chat images per signed-in user per 24 hours. Avatar limit is 10 per signed-in user per hour when Redis is available.

## Required Next.js/Vercel environment variables

For all three routes, configure:

- `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET` (server-only; never prefix with `NEXT_PUBLIC_`)

For product/chat uploads and their fail-closed safeguards, also configure:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `CLOUDINARY_UPLOADS_PAUSED=false` during normal operation

The avatar rate limiter also uses Upstash when available, but currently fails
open if Redis is missing; the avatar route does not use the Cloudinary usage
guard or the emergency pause switch. No Cloudinary upload preset or public API
key is required by the browser.

## Cloudinary Console cleanup

After the new deployment has passed the staging upload smoke tests and the
production deployment is approved:

1. Check Cloudinary Console → Settings → Upload → Upload presets.
2. Disable/delete old unsigned presets that were used by the former product/chat widgets, but only after confirming no other application or legacy client depends on them.
3. Review existing account assets separately; the new sanitizer does not retroactively inspect or remove old uploads.
4. Re-test product, chat and avatar uploads after preset cleanup.

Do not delete existing assets as part of this code change. Removing an image from a listing form does not automatically delete its Cloudinary asset; orphan cleanup remains a separate lifecycle task.
