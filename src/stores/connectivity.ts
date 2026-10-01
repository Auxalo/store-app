"use client";

import { create } from "zustand";

interface ConnectivityState {
  /** Browser's online hint. Phase 2's sync manager refines this with real request results. */
  online: boolean;
  setOnline: (online: boolean) => void;
}

export const useConnectivity = create<ConnectivityState>((set) => ({
  online: true,
  setOnline: (online) => set({ online }),
}));
