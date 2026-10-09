const CACHE_NAME = "ssv-offline-v2";
const SCOPE_URL = self.registration.scope;
const HOME_URL = new URL("./", SCOPE_URL).href;
const INDEX_URL = new URL("index.html", SCOPE_URL).href;

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Cache the actual site URL under this service worker's scope.
    const homeResponse = await fetch(HOME_URL, { cache: "reload" });
    if (!homeResponse.ok) throw new Error("Could not cache the homepage");
    await cache.put(HOME_URL, homeResponse.clone());
    // Also keep index.html as a fallback, but do not let this optional request
    // prevent installation if GitHub Pages redirects or handles it differently.
    try {
      const indexResponse = await fetch(INDEX_URL, { cache: "reload" });
      if (indexResponse.ok) await cache.put(INDEX_URL, indexResponse.clone());
    } catch (_) {}
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.startsWith("ssv-offline-") && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request);
        if (response && response.ok) {
          // Save the requested page and keep the canonical homepage fallback fresh.
          await cache.put(request, response.clone());
          if (url.pathname === new URL(HOME_URL).pathname) {
            await cache.put(HOME_URL, response.clone());
          }
        }
        return response;
      } catch (_) {
        return (await cache.match(request))
          || (await cache.match(HOME_URL))
          || (await cache.match(INDEX_URL))
          || new Response(
            '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sri Sai Vani Collections</title><body style="font-family:Arial,sans-serif;padding:24px;color:#333"><h2>Sri Sai Vani Collections</h2><p>You are offline. Please reconnect to the internet and reload the store.</p></body></html>',
            { headers: { "Content-Type": "text/html; charset=utf-8" } }
          );
      }
    })());
    return;
  }

  // Cache same-origin assets after successful requests for better repeat/offline loads.
  if (["image", "style", "script", "font"].includes(request.destination)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response && response.ok) await cache.put(request, response.clone());
      return response;
    })());
  }
});
