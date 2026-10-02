"use client";

import { create } from "zustand";

export type SyncProblem =
  /** Server unreachable or erroring; will retry. */
  | "network"
  | "server"
  /** This device is not trusted (or no longer is): sign in again. */
  | "auth"
  /** The app is too old for the server: update, the queue is kept. */
  | "upgrade"
  /** This device holds unsynced data from a different store. */
  | "storeMismatch";

interface SyncState {
  running: boolean;
  problem: SyncProblem | null;
  lastAttemptAt?: number;
  lastSyncAt?: number;
  /** True once the first full download finished (before that the screens may be empty). */
  initialSyncDone: boolean;
  /** How far the first download has got (the position in the shop's change history). */
  pulledTo?: number;
  deviceId?: string;
  deviceCode?: string;
  clockOffsetMs?: number;
  patch: (patch: Partial<Omit<SyncState, "patch">>) => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  running: false,
  problem: null,
  initialSyncDone: false,
  patch: (patch) => set(patch),
}));
