"use client";

import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import { useDataMode } from "@/data/mode-store";
import { getLocalDb } from "@/db/local/db";
import { useActiveUser } from "@/stores/active-user";
import { usePreferences } from "@/stores/preferences";
import type { DayRange, Summary } from "./compute";
import { loadSummary } from "./local";

export type ReportSource = "device" | "server";

export { presetRange, type RangePreset } from "./ranges";

/**
 * The report for a range. Offline mode reads this device and updates live as sales happen, with
 * no network. Online mode (and "server" in the picker) asks the server; a failed ask falls back to
 * this device only in offline mode, where the device has all the data.
 */
export function useSummary(
  range: DayRange,
  source: ReportSource = "device",
  enabled = true,
) {
  const timeZone = usePreferences((s) => s.timeZone);
  const mode = useDataMode();
  const wantServer = mode === "online" || source === "server";

  const local = useLiveQuery(
    () =>
      mode === "offline" && enabled
        ? loadSummary(getLocalDb(), range, timeZone)
        : undefined,
    [mode, enabled, range.from, range.to, timeZone],
  );
  const server = useQuery({
    queryKey: ["data", "summary", range.from, range.to],
    enabled: wantServer && enabled,
    retry: false,
    queryFn: async () => {
      const response = await fetch(
        `/api/reports/summary?from=${range.from}&to=${range.to}`,
      );
      if (response.status === 401) {
        const body = (await response.json().catch(() => ({}))) as {
          code?: string;
        };
        // The server does not know who is working on this device yet (a PIN was only checked on
        // the device): ask for the PIN again, which also tells the server.
        if (body.code === "PIN_REQUIRED" && !useActiveUser.getState().locked)
          useActiveUser.getState().lock();
        throw new Error(body.code ?? "401");
      }
      if (!response.ok) throw new Error(String(response.status));
      return ((await response.json()) as { summary: Summary }).summary;
    },
  });

  const serverFailed = wantServer && server.isError;
  return {
    summary: wantServer
      ? (server.data ??
        (serverFailed && mode === "offline" ? local : undefined))
      : local,
    serverFailed,
  };
}
