"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { FullScreenLoader } from "@/components/shared/full-screen-loader";
import { DataError } from "./errors";
import { useDataMode } from "./mode-store";
import { onModeChangedElsewhere } from "./mode-switch";
import { fetchHead } from "./online";

/** How often an online screen asks "has anything changed?" (one tiny request). */
const HEAD_POLL_MS = 60_000;

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
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
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    const check = async () => {
      try {
        const head = await fetchHead();
        if (stopped) return;
        if (last.current !== null && head !== last.current)
          void client.invalidateQueries({ queryKey: ["data"] });
        last.current = head;
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
