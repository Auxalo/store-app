import { withSerwist } from "@serwist/turbopack";
import type { NextConfig } from "next";
import pkg from "./package.json" with { type: "json" };

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version },
  poweredByHeader: false,
  async headers() {
    return [
      {
        // The service worker must always be revalidated so updates are picked up promptly.
        source: "/serwist/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default withSerwist(nextConfig);
