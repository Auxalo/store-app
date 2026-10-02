import type { DayRange } from "./compute";

const DAY_MS = 86_400_000;

const toUtc = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1);
};
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The days just before `range`, as many as it has (7 days → the 7 days before them). */
export function previousRange(range: DayRange): DayRange {
  const days = Math.round((toUtc(range.to) - toUtc(range.from)) / DAY_MS) + 1;
  const to = toUtc(range.from) - DAY_MS;
  return { from: fromUtc(to - (days - 1) * DAY_MS), to: fromUtc(to) };
}

/**
 * How a number moved compared with the period before it.
 *  - `flat`: no change (or both zero).
 *  - `new`: there was nothing before, so a percentage means nothing.
 *  - `up` / `down`: by `pct` percent of the earlier number (its size, so a loss that shrank
 *    reads as "up").
 */
export type Change =
  | { kind: "flat" }
  | { kind: "new" }
  | { kind: "up" | "down"; pct: number };

export function changeBetween(current: number, previous: number): Change {
  if (previous === 0) return current === 0 ? { kind: "flat" } : { kind: "new" };
  const delta = current - previous;
  const pct = Math.round((Math.abs(delta) / Math.abs(previous)) * 100);
  if (delta === 0 || pct === 0) return { kind: "flat" };
  return { kind: delta > 0 ? "up" : "down", pct };
}
