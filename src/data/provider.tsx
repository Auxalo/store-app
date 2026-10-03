"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { FullScreenLoader } from "@/components/shared/full-screen-loader";
import { DataError } from "./errors";
import { onHeadChange, setHead } from "./head";
import { useDataMode } from "./mode-store";
import { onModeChangedElsewhere } from "./mode-switch";
import { fetchHead } from "./online";

/** How often an online screen asks "has anything changed?" (one tiny request). */
const HEAD_POLL_MS = 60_000;

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

/** In online mode, refresh the screens when something changed on another device. */
function useChangeWatcher(client: QueryClient, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    // Someone else saved something: every screen on show asks again.
    const stopListening = onHeadChange(() => {
      void client.invalidateQueries({ queryKey: ["data"] });
    });
    const check = async () => {
      try {
        const head = await fetchHead();
        if (stopped) return;
        setHead(head); // listeners below hear about a change made by someone else
      } catch {
        /* no connection right now: the next check will try again */
      }
    };
    void check();
    const timer = setInterval(check, HEAD_POLL_MS);
    const onVisible = () =>
      document.visibilityState === "visible" && void check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      stopListening();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
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
