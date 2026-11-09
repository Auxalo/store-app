import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_Bengali } from "next/font/google";
import { Providers } from "@/components/layout/providers";
import "./globals.css";

// Both are self-hosted at build time, so they are precached and work offline.
const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-inter",
  display: "swap",
});
const bengali = Noto_Sans_Bengali({
  subsets: ["bengali"],
  variable: "--font-bengali",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Trade Hishab", template: "%s · Trade Hishab" },
  description:
    "Offline-first store management: sales, stock, purchases and accounts.",
  applicationName: "Trade Hishab",
  appleWebApp: {
    capable: true,
    title: "Trade Hishab",
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },
  // The app has its own Bangla and English: Chrome must not offer to translate it (it did every
  // time the Windows one-tap icon opened, in its fresh browser profile).
  other: { google: "notranslate" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="bn"
      translate="no"
      className={`${inter.variable} ${bengali.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
