import { type DayRange, dayKey } from "./compute";

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
