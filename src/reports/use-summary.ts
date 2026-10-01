"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { getLocalDb } from "@/db/local/db";
import { usePreferences } from "@/stores/preferences";
import { type DayRange, dayKey, type Summary } from "./compute";
import { loadSummary } from "./local";

export type ReportSource = "device" | "server";

export type RangePreset =
  | "today"
  | "yesterday"
  | "days7"
  | "days30"
  | "thisMonth"
  | "custom";

const DAY = 86_400_000;

/** The days a preset covers, in the store's time zone. */
export function presetRange(
  preset: Exclude<RangePreset, "custom">,
  timeZone: string,
  now = Date.now(),
): DayRange {
  const today = dayKey(now, timeZone);
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const day = dayKey(now - DAY, timeZone);
      return { from: day, to: day };
    }
    case "days7":
      return { from: dayKey(now - 6 * DAY, timeZone), to: today };
    case "days30":
      return { from: dayKey(now - 29 * DAY, timeZone), to: today };
    case "thisMonth":
      return { from: `${today.slice(0, 8)}01`, to: today };
  }
}

/**
 * The report for a range. From this device it updates live as sales happen, with no network. From
 * the server it fetches once per range; if that fails it falls back to this device and says so.
 */
export function useSummary(range: DayRange, source: ReportSource = "device") {
  const timeZone = usePreferences((s) => s.timeZone);
  const local = useLiveQuery(
    () => loadSummary(getLocalDb(), range, timeZone),
    [range.from, range.to, timeZone],
  );
  const [server, setServer] = useState<{
    key: string;
    summary: Summary;
  } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const key = `${range.from}|${range.to}`;

  useEffect(() => {
    if (source !== "server") return;
    let cancelled = false;
    fetch(`/api/reports/summary?from=${range.from}&to=${range.to}`)
      .then((response) =>
        response.ok
          ? response.json()
          : Promise.reject(new Error(String(response.status))),
      )
      .then((json: { summary: Summary }) => {
        if (cancelled) return;
        setServer({ key, summary: json.summary });
        setFailedKey(null);
      })
      .catch(() => !cancelled && setFailedKey(key));
    return () => {
      cancelled = true;
    };
  }, [source, key, range.from, range.to]);

  const fromServer =
    source === "server" && server?.key === key ? server.summary : undefined;
  return {
    summary:
      fromServer ??
      (source === "server" && failedKey !== key ? undefined : local),
    serverFailed: source === "server" && failedKey === key,
  };
}
