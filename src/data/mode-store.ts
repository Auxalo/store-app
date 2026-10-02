"use client";

import { create } from "zustand";
import { type DataMode, readStoredMode } from "./mode";

interface ModeState {
  /** Null until it is known (first paint uses the remembered value when there is one). */
  mode: DataMode | null;
  set: (mode: DataMode) => void;
}

export const useDataModeStore = create<ModeState>((set) => ({
  mode: readStoredMode(),
  set: (mode) => set({ mode }),
}));

/** This device's data mode, or null while it is still being worked out. */
export const useDataMode = () => useDataModeStore((s) => s.mode);
