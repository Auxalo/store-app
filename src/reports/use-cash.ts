"use client";

import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import { useDataMode } from "@/data/mode-store";
import { getLocalDb } from "@/db/local/db";
import { usePreferences } from "@/stores/preferences";
import type { CashReport } from "./cash";
import { loadCash } from "./cash-local";

/** The cash drawer's day: from this device (offline mode) or from the server (online mode). */
export function useCash(day: string, enabled = true): CashReport | undefined {
  const mode = useDataMode();
  const timeZone = usePreferences((s) => s.timeZone);
  const local = useLiveQuery(
    async () =>
      mode === "offline" && enabled
        ? loadCash(getLocalDb(), day, timeZone)
        : undefined,
    [mode, enabled, day, timeZone],
  );
  const online = useQuery({
    queryKey: ["data", "cash", day],
    enabled: mode === "online" && enabled,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/reports/cash?day=${day}`, { signal });
      if (!response.ok) throw new Error(String(response.status));
      return ((await response.json()) as { cash: CashReport }).cash;
    },
  });
  return mode === "online" ? online.data : local;
}
