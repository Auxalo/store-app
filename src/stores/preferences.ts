"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { defaultLocale, type Locale } from "@/i18n/config";
import { DEFAULT_TIME_ZONE } from "@/lib/constants";
import type { NumeralSystem } from "@/lib/format";

export type ReceiptPaper = "58mm" | "80mm" | "a4";

interface PreferencesState {
  locale: Locale;
  numerals: NumeralSystem;
  timeZone: string;
  receiptPaper: ReceiptPaper;
  /** The dashboard's store-worth amounts are shown as dots until tapped. */
  hideWorth: boolean;
  setLocale: (locale: Locale) => void;
  setNumerals: (numerals: NumeralSystem) => void;
  setReceiptPaper: (paper: ReceiptPaper) => void;
  setHideWorth: (hide: boolean) => void;
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
      receiptPaper: "80mm",
      hideWorth: false,
      setLocale: (locale) => set({ locale }),
      setNumerals: (numerals) => set({ numerals }),
      setReceiptPaper: (receiptPaper) => set({ receiptPaper }),
      setHideWorth: (hideWorth) => set({ hideWorth }),
    }),
    { name: "sa.prefs", version: 1 },
  ),
);
