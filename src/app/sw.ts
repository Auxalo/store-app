/// <reference lib="webworker" />
import {
  CacheFirst,
  ExpirationPlugin,
  NetworkOnly,
  type PrecacheEntry,
  Serwist,
  type SerwistGlobalConfig,
  StaleWhileRevalidate,
} from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * The service worker caches the app itself (HTML shell, JS, CSS, fonts, icons), never business
 * data. Store data lives in IndexedDB; /api/* always goes to the network.
 */
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // Detail pages are one static page that reads "?id=…" in the browser (so any product, even one
  // created offline, opens from the precache). Match precached pages whatever the query string.
  precacheOptions: { ignoreURLParametersMatching: [/.*/] },
  // Only an explicit "Update" tap activates a waiting worker, so a sale is never interrupted.
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: [
    // Business and auth APIs: never cached.
    {
      matcher: ({ url }) => url.pathname.startsWith("/api/"),
      handler: new NetworkOnly(),
    },
    // Next static assets are content-hashed, so they can be cached forever.
    {
      matcher: ({ url }) => url.pathname.startsWith("/_next/static/"),
      handler: new CacheFirst({
        cacheName: "next-static",
        plugins: [
          new ExpirationPlugin({
            maxEntries: 300,
            maxAgeSeconds: 60 * 60 * 24 * 365,
          }),
        ],
      }),
    },
    // Icons and other public images.
    {
      matcher: ({ request }) => request.destination === "image",
      handler: new StaleWhileRevalidate({
        cacheName: "images",
        plugins: [
          new ExpirationPlugin({
            maxEntries: 100,
            maxAgeSeconds: 60 * 60 * 24 * 30,
          }),
        ],
      }),
    },
    // Page navigations and the RSC payloads next/link requests: prefer fresh, fall back offline.
    {
      matcher: ({ request, sameOrigin }) =>
        sameOrigin &&
        (request.mode === "navigate" || request.headers.get("RSC") === "1"),
      handler: new StaleWhileRevalidate({
        cacheName: "pages",
        plugins: [new ExpirationPlugin({ maxEntries: 120 })],
      }),
    },
  ],
  fallbacks: {
    entries: [
      {
        // Any uncached document navigation falls back to the precached app entry.
        url: "/",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();
