"use client";

import { SerwistProvider } from "@serwist/turbopack/react";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { useIsClient } from "usehooks-ts";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n/provider";
import { ConnectivityWatcher } from "./connectivity-watcher";
import { ErrorReporter } from "./error-reporter";
import { SwUpdateNotifier } from "./sw-update-notifier";

/**
 * Everything is client-rendered: language, theme and business data all live on the device,
 * so nothing is rendered until the saved preferences are known. This avoids a flash of
 * the wrong language and keeps the precached HTML a tiny, user-independent shell.
 */
export function Providers({ children }: { children: ReactNode }) {
  const isClient = useIsClient();

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {/* reloadOnOnline (on by default) would reload the page mid-sale whenever Wi-Fi comes
          back. The sync engine already reacts to reconnects without a reload. */}
      <SerwistProvider
        swUrl="/serwist/sw.js"
        disable={process.env.NODE_ENV === "development"}
        reloadOnOnline={false}
      >
        {isClient ? (
          <I18nProvider>
            <TooltipProvider>
              <ConnectivityWatcher />
              <ErrorReporter />
              <SwUpdateNotifier />
              {children}
              <Toaster position="top-center" />
            </TooltipProvider>
          </I18nProvider>
        ) : null}
      </SerwistProvider>
    </ThemeProvider>
  );
}
