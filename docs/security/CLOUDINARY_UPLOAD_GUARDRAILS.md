# MaliHub image-upload security

## Upload architecture

All new product, chat and avatar images pass through MaliHub's authenticated server-side upload handlers:

- Product and chat images: `POST /api/uploads/images`
- Profile avatars: `POST /api/avatar/upload`

The browser never receives Cloudinary signing authority and never uploads directly to Cloudinary. The former `POST /api/cloudinary/sign` endpoint returns HTTP 410 and cannot issue signatures.

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
- Upload handlers fail closed if Upstash Redis or Cloudinary usage protection is unavailable.
- Cloudinary usage warns at 70%, pauses new uploads at 85%, and supports the emergency `CLOUDINARY_UPLOADS_PAUSED=true` switch.

## Required Vercel environment variables

- `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET` (server-only; never prefix with `NEXT_PUBLIC_`)
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `CLOUDINARY_UPLOADS_PAUSED=false`

No Cloudinary upload preset or public API key is required by the browser.

## Cloudinary Console cleanup

After the new deployment has passed the upload smoke tests:

1. Check Cloudinary Console → Settings → Upload → Upload presets.
2. Disable/delete old unsigned presets that were used by the former product/chat widgets, but only after confirming no other application or legacy client depends on them.
3. Review existing account assets separately; the new sanitizer does not retroactively inspect or remove old uploads.
4. Re-test product, chat and avatar uploads after preset cleanup.

Do not delete existing assets as part of this code change. Removing an image from a listing form does not automatically delete its Cloudinary asset; orphan cleanup remains a separate lifecycle task.
