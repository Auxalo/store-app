"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { defaultLocale, type Locale } from "@/i18n/config";
import { DEFAULT_TIME_ZONE } from "@/lib/constants";
import type { NumeralSystem } from "@/lib/format";

interface PreferencesState {
  locale: Locale;
  numerals: NumeralSystem;
  timeZone: string;
  setLocale: (locale: Locale) => void;
  setNumerals: (numerals: NumeralSystem) => void;
}

/**
 * Tiny UI preferences only (spec §17 allows localStorage for these). Business data
 * never goes here — it lives in IndexedDB.
 */
export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      locale: defaultLocale,
      numerals: "auto",
      timeZone: DEFAULT_TIME_ZONE,
      setLocale: (locale) => set({ locale }),
      setNumerals: (numerals) => set({ numerals }),
    }),
    { name: "sa.prefs", version: 1 },
  ),
);
