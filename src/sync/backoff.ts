const STEPS_MS = [5_000, 15_000, 60_000, 300_000];

/** Wait before retry number `attempts` (1-based): 5s, 15s, 1m, then 5m, ±20% so devices spread out. */
export function backoffDelay(
  attempts: number,
  random: () => number = Math.random,
): number {
  const base =
    STEPS_MS[Math.min(Math.max(attempts, 1) - 1, STEPS_MS.length - 1)];
  return Math.round(base * (0.8 + random() * 0.4));
}
