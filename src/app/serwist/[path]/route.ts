import { createSerwistRoute } from "@serwist/turbopack";

// Builds src/app/sw.ts into /serwist/sw.js (see src/app/sw.ts for what gets cached).
export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    swSrc: "src/app/sw.ts",
    globDirectory: ".next",
    globPatterns: [
      "static/**/*.{js,css,woff2,png,svg,ico}",
      "server/app/**/*.html",
    ],
    globIgnores: [
      "**/*.map",
      "server/app/api/**",
      "server/app/serwist/**",
      "static/chunks/**/*.hot-update.*",
    ],
    // Files under .next/static are served from /_next/static
    modifyURLPrefix: { "static/": "/_next/static/", "server/app/": "/" },
    manifestTransforms: [
      (entries) => ({
        warnings: [],
        manifest: entries
          // Next serves its error pages internally; they are not real routes to cache.
          .filter(
            (entry) => !/^\/?_(not-found|global-error)\.html$/.test(entry.url),
          )
          // Next serves the prerendered page for /login at "/login", not "/login.html".
          // Precaching ".html" URLs would 404 and make the whole service worker install fail.
          .map((entry) => {
            const match = /^\/?(.*)\.html$/.exec(entry.url);
            if (!match) return entry;
            const route = match[1] === "index" ? "/" : `/${match[1]}`;
            return { ...entry, url: route };
          }),
      }),
    ],
    useNativeEsbuild: true,
  });
