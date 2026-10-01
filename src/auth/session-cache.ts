import type { Role } from "./permissions";

/**
 * Last known signed-in profile, kept so the app can open offline.
 * Not a credential: it only lets the UI render; the server still authorizes everything.
 * (Phase 2 moves this into IndexedDB next to the offline PIN unlock data.)
 */
export interface CachedProfile {
  userId: string;
  name: string;
  username: string;
  role: Role;
  storeId: string;
  storeName?: string;
  cachedAt: number;
}

const KEY = "sa.profile";

export function readProfile(): CachedProfile | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CachedProfile) : null;
  } catch {
    return null;
  }
}

export function writeProfile(profile: CachedProfile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    /* storage unavailable: the app still works while signed in */
  }
}

export function clearProfile(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
