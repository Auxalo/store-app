"use client";

import { create } from "zustand";

interface ActiveUserState {
  /** True until someone enters their PIN (only matters when PINs are in use). Never persisted: every app start asks again. */
  locked: boolean;
  /** Who unlocked the counter. */
  activeUserId: string | null;
  /** Working as the signed-in account itself (just signed in with the password, or no PINs existed yet). */
  asAccount: boolean;
  /**
   * The key that signs this person's offline work (made from the PIN they just typed). Kept in
   * memory only, so a reload or a lock forgets it and the next unlock makes it again.
   */
  proof: { userId: string; key: string } | null;
  unlock: (userId: string, proofKey?: string) => void;
  /** The person working has just set their own PIN: they can sign from now on. */
  setProof: (userId: string, proofKey: string) => void;
  openAsAccount: () => void;
  lock: () => void;
}

export const useActiveUser = create<ActiveUserState>((set) => ({
  locked: true,
  activeUserId: null,
  asAccount: false,
  proof: null,
  unlock: (userId, proofKey) =>
    set({
      locked: false,
      activeUserId: userId,
      asAccount: false,
      proof: proofKey ? { userId, key: proofKey } : null,
    }),
  setProof: (userId, proofKey) => set({ proof: { userId, key: proofKey } }),
  openAsAccount: () =>
    set({ locked: false, activeUserId: null, asAccount: true }),
  lock: () => {
    set({ locked: true, asAccount: false, proof: null });
    // The server also forgets who was working, whatever the mode: a device in offline mode is
    // told who is working when someone unlocks while online, and that must end with the lock too.
    void fetch("/api/actor/lock", { method: "POST" }).catch(() => undefined);
  },
}));
