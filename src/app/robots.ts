import type { MetadataRoute } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://malihub.co.ke";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // The dashboard screens live under the (dashboard) route group, so
        // their public URLs carry no /dashboard segment — /buyer, /seller,
        // /admin. The trailing slashes keep the public /sellers/[slug]
        // storefronts crawlable.
        disallow: ["/buyer/", "/seller/", "/admin", "/api/", "/reset-password"],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
