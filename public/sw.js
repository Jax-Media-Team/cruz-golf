// Cruz Golf — minimal service worker.
//
// Goals (per CLAUDE.md "PWA reliability" priority):
//   - App shell loads instantly from cache when offline
//   - Static assets (logos, fonts) cached aggressively
//   - HTML pages: network-first with cache fallback so users on the
//     course with bad service still see the last-rendered page
//   - API routes: network-only, never cached (writes go through the
//     existing useScoreSaver outbox queue which retries on reconnect)
//   - Auth callbacks pass through untouched
//
// Cache version is bumped on each release so users pick up new assets.
// The 'offline' fallback is the dashboard shell — they at least see the
// app frame instead of a Chrome dinosaur.

// Bumped to v4 on 2026-05-12 (third time today). Patrick preferred
// the earlier wider crop over the close-crop medallion version, so
// the cruz-icon-* files revert to the original center-square crop of
// the full brand lockup. Cache bump forces re-fetch of the new bytes.
const CACHE_VERSION = "cruz-golf-v4";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const PAGES_CACHE = `${CACHE_VERSION}-pages`;

// Files to pre-cache on install. Keep this list small — most assets
// will get cached on first fetch. Cruz-logo dropped from this list
// 2026-05-12 — the square cruz-icon-*.png files replace it on the
// home screen.
const PRECACHE_URLS = [
  "/cruz-icon-180.png",
  "/cruz-icon-192.png",
  "/cruz-icon-512.png",
  "/manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Clean up old cache versions when a new SW activates.
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin requests. Cross-origin (Supabase, etc.)
  // passes through untouched.
  if (url.origin !== self.location.origin) return;

  // Never cache POST / PUT / DELETE — those are mutations.
  if (req.method !== "GET") return;

  // Auth callbacks pass through.
  if (url.pathname.startsWith("/auth/") || url.pathname.startsWith("/login")) {
    return;
  }

  // API routes: network-only (writes + dynamic data). The existing
  // useScoreSaver queue handles offline write resilience.
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // Static assets: cache-first. /_next/static/* + /cruz-logo.png +
  // /manifest.webmanifest + any /public/* paths.
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/cruz-logo") ||
    url.pathname.startsWith("/manifest") ||
    url.pathname.match(/\.(png|jpg|jpeg|svg|webp|gif|ico|woff2?|ttf|css|js)$/)
  ) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }

  // HTML pages + everything else: network-first, fallback to cached
  // last-known version. Lets a user on the course with terrible
  // service still see the most recent /dashboard or /rounds/[id].
  event.respondWith(networkFirstThenCache(req, PAGES_CACHE));
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (err) {
    // No cache + offline → return a synthetic 503. The page will
    // typically render its own offline state.
    return new Response("offline", { status: 503, statusText: "Offline" });
  }
}

async function networkFirstThenCache(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(req);
    if (fresh.ok) {
      // Only cache successful HTML/JSON responses, not 4xx/5xx.
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    // Last-resort fallback: try the dashboard shell.
    const shell = await cache.match("/dashboard");
    if (shell) return shell;
    return new Response(
      "<html><body style=\"font-family:system-ui;padding:2rem;background:#0a1f1a;color:#f5efe0\"><h1>You're offline</h1><p>Connect to the internet to load this page.</p></body></html>",
      { status: 503, headers: { "Content-Type": "text/html" } }
    );
  }
}
