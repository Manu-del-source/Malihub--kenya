import type { NextConfig } from "next";

/**
 * Security response headers.
 *
 * ─── CSP ────────────────────────────────────────────────────────────────────
 * Allowlist, built from what the app ACTUALLY loads (audited, not guessed):
 *
 *  - scripts: our own bundles, Next.js inline flight/style tags (App Router
 *    requires 'unsafe-inline' for RSC script tags — a known residual, see
 *    .audit/), Paystack InlineJS (checkout), and the Cloudinary upload
 *    widget's loader (the only third-party script on any page).
 *  - connect: Paystack API + checkout host, and Cloudinary's upload endpoint
 *    and CDN (the upload widget XHRs there). Supabase was dropped here in
 *    Phase 4 of docs/SUPABASE-REMOVAL-PLAN.md: the browser no longer talks to
 *    it at all (avatars go through POST /api/avatar/upload, chat realtime goes
 *    through our own POST /api/chat/ws-ticket + the FastAPI WebSocket), so no
 *    `*.supabase.co` / `wss://*.supabase.co` origin is needed.
 *  - images: our own, data/blob (picker previews), Cloudinary, Google profile
 *    avatars, and `*.supabase.co` — that last one is LEGACY-only, for avatars
 *    still hosted in the old Supabase bucket until the avatar migration in
 *    scripts/migrate-avatars-to-cloudinary.mjs is verified in production.
 *  - frames: same-origin only, plus Paystack's checkout host. The Cloudinary
 *    upload widget opens its UI in a POPUP window (its own origin, outside
 *    our CSP's frame-src), so no Cloudinary frame entry is needed.
 *
 * ─── HSTS ───────────────────────────────────────────────────────────────────
 * Browsers ignore HSTS on plain HTTP and localhost, so this is a no-op in
 * dev and takes effect behind the HTTPS deployment. One year, subdomains.
 */
const SECURITY_HEADERS: { key: string; value: string }[] = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://js.paystack.co https://upload-widget.cloudinary.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://res.cloudinary.com https://*.supabase.co https://lh3.googleusercontent.com",
      "font-src 'self' data:",
      "connect-src 'self' https://api.paystack.co https://checkout.paystack.com https://api.cloudinary.com https://res.cloudinary.com",
      "frame-src 'self' https://checkout.paystack.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(self)",
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // NOTE: typedRoutes is off on purpose. It fights plain-string hrefs built
    // from URLSearchParams (`/search?${params}`), which the hero search bar
    // and the upcoming search page both rely on. Worth revisiting later with
    // explicit `Route` casts if compile-time route safety becomes a priority.
    serverActions: {
      bodySizeLimit: "5mb",
    },
  },
  images: {
    formats: ["image/avif", "image/webp"],
    // Every entry is a host the app actually serves from. `next/image`
    // refuses anything outside this list at runtime, so the allowlist is
    // enforced, not advisory.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
        // LEGACY avatars only. Nothing uploads here since Phase 2 (avatars are
        // written to Cloudinary); this entry keeps pre-migration avatars
        // renderable and comes out once the avatar migration is verified in
        // production. See docs/SUPABASE-REMOVAL-PLAN.md §3 and §6.
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
  async redirects() {
    return [];
  },
};

export default nextConfig;
