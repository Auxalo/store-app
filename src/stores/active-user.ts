"use client";

import { create } from "zustand";

interface ActiveUserState {
  /** True until someone enters their PIN (only matters when PINs are in use). Never persisted: every app start asks again. */
  locked: boolean;
  /** Who unlocked the counter. */
  activeUserId: string | null;
  /** Working as the signed-in account itself (just signed in with the password, or no PINs existed yet). */
  asAccount: boolean;
  unlock: (userId: string) => void;
  openAsAccount: () => void;
  lock: () => void;
}

export const useActiveUser = create<ActiveUserState>((set) => ({
  locked: true,
  activeUserId: null,
  asAccount: false,
  unlock: (userId) =>
    set({ locked: false, activeUserId: userId, asAccount: false }),
  openAsAccount: () =>
    set({ locked: false, activeUserId: null, asAccount: true }),
  lock: () => set({ locked: true, asAccount: false }),
}));
