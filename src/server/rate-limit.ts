import "server-only";
import { HttpError } from "./http";

/**
 * A simple per-device limit on how often the online endpoints may be asked, so one stuck client
 * (a loop, a broken script) cannot flood the database. It counts in a one-minute window kept in
 * this server process's memory, so with several server processes each has its own count: it is
 * a safety net against runaway clients, not a security boundary (a proxy in front is the place
 * for that). Normal use is far below it: a busy counter makes a few requests a second at most.
 */
const WINDOW_MS = 60_000;

const limits = () => ({
  read: Number(process.env.RATE_LIMIT_READ_PER_MIN ?? 600),
  write: Number(process.env.RATE_LIMIT_WRITE_PER_MIN ?? 180),
});

interface Counter {
  windowStart: number;
  count: number;
}
const counters = new Map<string, Counter>();

/** Throws 429 when `deviceId` has used up its requests for this minute. */
export function checkRateLimit(
  deviceId: string,
  kind: "read" | "write",
  now = Date.now(),
): void {
  if (process.env.E2E_DISABLE_RATE_LIMIT === "1") return;
  const key = `${kind}:${deviceId}`;
  let entry = counters.get(key);
  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    entry = { windowStart: now, count: 0 };
    counters.set(key, entry);
    // Forget devices that went quiet, so the map cannot grow without end.
    if (counters.size > 5_000)
      for (const [k, v] of counters)
        if (now - v.windowStart >= WINDOW_MS) counters.delete(k);
  }
  entry.count++;
  if (entry.count > limits()[kind]) throw new HttpError(429, "RATE_LIMITED");
}

const budgets = new Map<string, number[]>();

/**
 * At most `max` uses of `key` in `windowMs` (for rare actions, such as a shop sending a payment:
 * a handful an hour). Like the limit above, it is counted in this process's memory.
 */
export function checkBudget(
  key: string,
  max: number,
  windowMs: number,
  now = Date.now(),
): void {
  if (process.env.E2E_DISABLE_RATE_LIMIT === "1") return;
  const recent = (budgets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) throw new HttpError(429, "RATE_LIMITED");
  recent.push(now);
  budgets.set(key, recent);
  if (budgets.size > 5_000)
    for (const [k, times] of budgets)
      if (times.every((t) => now - t >= windowMs)) budgets.delete(k);
}

export function resetRateLimits(): void {
  counters.clear();
  budgets.clear();
}
