/**
 * Wrong-PIN policy, so a PIN cannot simply be guessed at the counter:
 *   - the first 4 mistakes cost nothing
 *   - from the 5th, wait 30 s, doubling each time (capped at 15 min)
 *   - from the 15th, the PIN stops working until the person signs in again online
 */
export const FREE_ATTEMPTS = 4;
export const ONLINE_LOGIN_AFTER = 15;
const BASE_WAIT_MS = 30_000;
const MAX_WAIT_MS = 15 * 60_000;

export interface LockoutState {
  /** Must wait before the next try. */
  waitMs: number;
  /** The PIN no longer works on this device until an online sign-in. */
  needsOnlineLogin: boolean;
  /** Mistakes left before the waiting starts (0 once it has). */
  freeLeft: number;
}

export function lockoutState(
  failures: number,
  lastFailedAt: number,
  now: number,
): LockoutState {
  if (failures >= ONLINE_LOGIN_AFTER)
    return { waitMs: 0, needsOnlineLogin: true, freeLeft: 0 };
  if (failures <= FREE_ATTEMPTS) {
    return {
      waitMs: 0,
      needsOnlineLogin: false,
      freeLeft: FREE_ATTEMPTS + 1 - failures,
    };
  }
  const wait = Math.min(
    BASE_WAIT_MS * 2 ** (failures - FREE_ATTEMPTS - 1),
    MAX_WAIT_MS,
  );
  return {
    waitMs: Math.max(0, lastFailedAt + wait - now),
    needsOnlineLogin: false,
    freeLeft: 0,
  };
}
