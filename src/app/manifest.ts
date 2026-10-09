import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Heshabe | হিসাবি",
    short_name: "Heshabe",
    description:
      "Offline-first store management: sales, stock, purchases and accounts.",
    lang: "bn",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#ffffff",
    theme_color: "#15803d",
    icons: [
      {
        src: "/pwa-icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa-icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa-icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "POS",
        url: "/pos",
        icons: [{ src: "/pwa-icons/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
