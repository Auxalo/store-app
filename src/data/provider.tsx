"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { FullScreenLoader } from "@/components/shared/full-screen-loader";
import { DataError } from "./errors";
import { onHeadChange } from "./head";
import { useDataMode } from "./mode-store";
import { onModeChangedElsewhere } from "./mode-switch";

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // The head check below is what says "something changed"; with it, coming back to the
        // tab or a minute passing is no reason to ask for everything again.
        staleTime: 60_000,
        refetchOnWindowFocus: false,
        // Retry a flaky connection a couple of times, but not an answer like "not allowed".
        retry: (count, error) =>
          count < 2 &&
          (!(error instanceof DataError) ||
            error.status === 0 ||
            error.status >= 500),
      },
    },
  });
}

/**
 * In online mode, refresh the screens when something changed on another device. The "has anything
 * changed?" question is asked by the sync cycle (src/sync/online-cycle.ts: every few minutes, and
 * when the tab is shown again), which tells this listener when the answer moved.
 */
function useChangeWatcher(client: QueryClient, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    // Someone else saved something: every screen on show asks again.
    return onHeadChange(() => {
      void client.invalidateQueries({ queryKey: ["data"] });
    });
  }, [client, enabled]);
}

/**
 * Gives screens their data. Waits until this device's mode is known (it is read in a moment),
 * then provides the query cache used in online mode and watches for changes from other devices.
 */
export function DataProvider({ children }: { children: ReactNode }) {
  const [client] = useState(makeClient);
  const mode = useDataMode();
  useChangeWatcher(client, mode === "online");
  // Another tab of this device switched mode: reload into it, so every tab agrees.
  useEffect(() => onModeChangedElsewhere(() => location.reload()), []);
  if (mode === null) return <FullScreenLoader />;
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
