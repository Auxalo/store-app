"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { authClient } from "./client";
import { isRole } from "./permissions";
import {
  type CachedProfile,
  clearProfile,
  readProfile,
  writeProfile,
} from "./session-cache";

export type AuthState =
  | { status: "loading"; profile: null }
  | { status: "unauthenticated"; profile: null }
  | { status: "authenticated"; profile: CachedProfile; offline: boolean };

/**
 * Session state that survives being offline: a live server session wins, but if the
 * server cannot be reached we fall back to the last known profile on this device.
 */
export function useAuth(): AuthState {
  const { data, isPending, error } = authClient.useSession();
  // localStorage is read after mount so server HTML and the first client render agree.
  const [cached, setCached] = useState<CachedProfile | null | undefined>(
    undefined,
  );
  useEffect(() => setCached(readProfile()), []);

  const user = data?.user;
  const live = useMemo<CachedProfile | null>(() => {
    if (!user || !isRole(user.role)) return null;
    return {
      userId: user.id,
      name: user.name,
      username: user.username ?? "",
      role: user.role,
      storeId: user.storeId,
      storeName: readProfile()?.storeName,
      cachedAt: Date.now(),
    };
  }, [user]);

  const liveKey = live ? `${live.userId}:${live.role}:${live.storeId}` : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on identity, not the object
  useEffect(() => {
    if (!live) return;
    writeProfile(live);
    if (live.storeName) return;
    fetch("/api/stores/current")
      .then((r) => (r.ok ? r.json() : null))
      .then((store: { name?: string } | null) => {
        if (store?.name) writeProfile({ ...live, storeName: store.name });
      })
      .catch(() => {});
  }, [liveKey]);

  const unreachable =
    !!error || (typeof navigator !== "undefined" && !navigator.onLine);

  if (live) return { status: "authenticated", profile: live, offline: false };
  if (cached === undefined) return { status: "loading", profile: null };
  if (isPending) {
    return cached
      ? { status: "authenticated", profile: cached, offline: false }
      : { status: "loading", profile: null };
  }
  if (cached && unreachable)
    return { status: "authenticated", profile: cached, offline: true };
  return { status: "unauthenticated", profile: null };
}

const ProfileContext = createContext<CachedProfile | null>(null);

export function ProfileProvider({
  profile,
  children,
}: {
  profile: CachedProfile;
  children: ReactNode;
}) {
  return (
    <ProfileContext.Provider value={profile}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile(): CachedProfile {
  const profile = useContext(ProfileContext);
  if (!profile) throw new Error("useProfile must be used inside <AuthGate>");
  return profile;
}

/**
 * Ends the session on the server, then forgets this device's copy. Returns false when the server
 * refused: the session is then still alive, so going to the sign-in page would only bounce the
 * person straight back in. The caller says so instead of pretending.
 */
export async function signOut(): Promise<boolean> {
  try {
    const { error } = await authClient.signOut();
    if (error?.status) return false;
  } catch {
    /* offline: still clear this device */
  }
  clearProfile();
  return true;
}
