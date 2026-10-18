"use client";

import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import { useDataMode } from "@/data/mode-store";
import { getLocalDb } from "@/db/local/db";
import { usePreferences } from "@/stores/preferences";
import type { CashReport, MoneyFlow } from "./cash";
import { loadCash, loadMoney } from "./cash-local";
import type { DayRange } from "./compute";

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

/** Money in and out for the days of `range`, by payment method: from this device or from the server. */
export function useMoneyFlow(
  range: DayRange,
  enabled = true,
): MoneyFlow | undefined {
  const mode = useDataMode();
  const timeZone = usePreferences((s) => s.timeZone);
  const local = useLiveQuery(
    async () =>
      mode === "offline" && enabled
        ? loadMoney(getLocalDb(), range, timeZone)
        : undefined,
    [mode, enabled, range.from, range.to, timeZone],
  );
  const online = useQuery({
    queryKey: ["data", "money", range.from, range.to],
    enabled: mode === "online" && enabled,
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `/api/reports/money?from=${range.from}&to=${range.to}`,
        { signal },
      );
      if (!response.ok) throw new Error(String(response.status));
      return ((await response.json()) as { money: MoneyFlow }).money;
    },
  });
  return mode === "online" ? online.data : local;
}

/** The same, from this device only (for a screen whose online figure arrives with its own request). */
export function useLocalMoney(
  range: DayRange,
  enabled: boolean,
): MoneyFlow | undefined {
  const timeZone = usePreferences((s) => s.timeZone);
  return useLiveQuery(
    async () =>
      enabled ? loadMoney(getLocalDb(), range, timeZone) : undefined,
    [enabled, range.from, range.to, timeZone],
  );
}
