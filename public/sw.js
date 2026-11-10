const CACHE_PREFIX = "malihub-";
const STATIC_CACHE = "malihub-static-v2";
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.add(OFFLINE_URL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== STATIC_CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Never cache mutations, cross-origin requests, API responses, or private pages.
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/buyer/") ||
    url.pathname.startsWith("/seller/") ||
    url.pathname.startsWith("/admin") ||
    url.pathname.startsWith("/reset-password")
  ) {
    return;
  }

  // Navigation is network-only. If offline, show the dedicated offline page;
  // authenticated HTML and account data are never written to Cache Storage.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cachedOffline = await caches.match(OFFLINE_URL);
        return cachedOffline || new Response(
          "You are offline. Reconnect and try again.",
          { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
        );
      })
    );
    return;
  }

  // Cache only immutable Next.js assets and public PWA icons.
  const isImmutableAsset = url.pathname.startsWith("/_next/static/");
  const isAppIcon = [
    "/icon.svg",
    "/pwa-icon-192",
    "/pwa-icon-512",
    "/apple-icon.png",
  ].includes(url.pathname);
  if (!isImmutableAsset && !isAppIcon) return;

  event.respondWith(
    caches.open(STATIC_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;

      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        await cache.put(request, response.clone());
      }
      return response;
    })
  );
});
