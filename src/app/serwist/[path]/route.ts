import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { createSerwistRoute } from "@serwist/turbopack";

/**
 * Every page of the app, from the source folders (route groups dropped): these are what the
 * service worker saves so the app opens offline.
 *
 * They used to be found by looking for the built HTML files, but this route is itself prerendered
 * during `next build`, sometimes before those files were written, and then the list had no pages
 * at all: the app installed but did not open offline. The source folders are always complete.
 * The operator panel and dynamic routes are left out (the panel is used online only).
 */
function pageRoutes(): string[] {
  const root = join(process.cwd(), "src", "app");
  try {
    return readdirSync(root, { recursive: true })
      .map((file) => String(file).split(/[\\/]/))
      .filter((parts) => parts.at(-1) === "page.tsx")
      .map((parts) => parts.slice(0, -1))
      .filter(
        (dirs) =>
          !dirs.some(
            (d) => d === "(admin)" || d === "api" || d.startsWith("["),
          ),
      )
      .map((dirs) => `/${dirs.filter((d) => !/^\(.*\)$/.test(d)).join("/")}`);
  } catch {
    return []; // not at build time (the prerendered worker is served instead)
  }
}

// One revision per build: a new deployment refreshes every saved page once.
const revision = process.env.VERCEL_GIT_COMMIT_SHA ?? randomUUID();

// Builds src/app/sw.ts into /serwist/sw.js (see src/app/sw.ts for what gets cached).
export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    swSrc: "src/app/sw.ts",
    globDirectory: ".next",
    globPatterns: ["static/**/*.{js,css,woff2,png,svg,ico}"],
    globIgnores: ["**/*.map", "static/chunks/**/*.hot-update.*"],
    // Files under .next/static are served from /_next/static
    modifyURLPrefix: { "static/": "/_next/static/" },
    additionalPrecacheEntries: pageRoutes().map((url) => ({ url, revision })),
    useNativeEsbuild: true,
  });
