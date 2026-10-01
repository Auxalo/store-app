"use client";

import { type ReactNode, useEffect } from "react";
import { useProfile } from "@/auth/use-auth";
import { startSyncManager } from "@/sync/manager";

/** Starts background sync while a user is signed in (including offline, from the cached profile). */
export function SyncProvider({ children }: { children: ReactNode }) {
  const { storeId } = useProfile();

  useEffect(() => startSyncManager({ storeId }), [storeId]);

  return children;
}
