"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { type ReactNode, useEffect, useMemo } from "react";
import { ProfileProvider, useProfile } from "@/auth/use-auth";
import { LockScreen } from "@/components/lock/lock-screen";
import { FullScreenLoader } from "@/components/shared/full-screen-loader";
import { getLocalDb } from "@/db/local/db";
import { useSetting } from "@/hooks/use-setting";
import { useActiveUser } from "@/stores/active-user";

const ACTIVITY_EVENTS = [
  "pointerdown",
  "keydown",
  "touchstart",
  "wheel",
] as const;

/**
 * Once anyone in the store has a PIN, the counter asks "who is working?" on every start and after
 * a period of inactivity, and the rest of the app then runs as that person (their role decides what
 * they can see and do; the server re-checks every action under their name).
 *
 * With no PINs set at all, this does nothing and the signed-in account is used as before.
 */
export function ActiveUserGate({ children }: { children: ReactNode }) {
  const session = useProfile();
  const users = useLiveQuery(() => getLocalDb().localUsers.toArray(), []);
  const { locked, activeUserId, asAccount, unlock, openAsAccount, lock } =
    useActiveUser();
  const { value: idleMinutes } = useSetting<number>(
    "security.idleLockMinutes",
    10,
  );

  const pinUsers = useMemo(
    () => (users ?? []).filter((u) => u.isActive && u.pinHash),
    [users],
  );
  const active = pinUsers.find((u) => u.userId === activeUserId);
  const pinsInUse = pinUsers.length > 0;

  // Lock after a stretch with no taps, clicks or keys.
  useEffect(() => {
    if (!pinsInUse || locked || !idleMinutes || idleMinutes <= 0) return;
    let timer = setTimeout(lock, idleMinutes * 60_000);
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(lock, idleMinutes * 60_000);
    };
    for (const type of ACTIVITY_EVENTS)
      window.addEventListener(type, reset, { passive: true });
    return () => {
      clearTimeout(timer);
      for (const type of ACTIVITY_EVENTS)
        window.removeEventListener(type, reset);
    };
  }, [pinsInUse, locked, idleMinutes, lock]);

  // With no PINs yet, whoever is signed in is working. If the owner then adds the first PIN, they
  // keep working (they are not shut out) until the counter next locks.
  useEffect(() => {
    if (users !== undefined && !pinsInUse && !asAccount) openAsAccount();
  }, [users, pinsInUse, asAccount, openAsAccount]);

  // The person who was working was deactivated or lost their PIN: ask again.
  useEffect(() => {
    if (pinsInUse && !locked && !asAccount && !active) lock();
  }, [pinsInUse, locked, asAccount, active, lock]);

  if (users === undefined) return <FullScreenLoader />;
  if (!pinsInUse || (asAccount && !locked)) return children;
  if (locked || !active)
    return (
      <LockScreen
        users={pinUsers}
        storeName={session.storeName}
        onUnlock={unlock}
      />
    );

  return (
    <ProfileProvider
      profile={{
        ...session,
        userId: active.userId,
        name: active.name,
        username: active.username,
        role: active.role,
      }}
    >
      {children}
    </ProfileProvider>
  );
}
