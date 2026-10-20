"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { defaultLocale, type Locale } from "@/i18n/config";
import { DEFAULT_TIME_ZONE } from "@/lib/constants";
import type { NumeralSystem } from "@/lib/format";

export type ReceiptPaper = "58mm" | "80mm" | "a4";

/** The receipt printer chosen on this device (the paper width is `receiptPaper`). */
export interface PrinterPrefs {
  /** How the receipt reaches it; null until someone has chosen. */
  via: "serial" | "ble" | "rawbt" | "system" | null;
  /** Shown to people. */
  name?: string;
  /** A Bluetooth Low Energy device's id, to find it again. */
  id?: string;
  /** Print by itself as soon as a sale is saved. */
  autoPrint: boolean;
}

interface PreferencesState {
  locale: Locale;
  numerals: NumeralSystem;
  timeZone: string;
  receiptPaper: ReceiptPaper;
  printer: PrinterPrefs;
  /** The dashboard's store-worth amounts are shown as dots until tapped. */
  hideWorth: boolean;
  setLocale: (locale: Locale) => void;
  setNumerals: (numerals: NumeralSystem) => void;
  setReceiptPaper: (paper: ReceiptPaper) => void;
  setPrinter: (printer: Partial<PrinterPrefs>) => void;
  clearPrinter: () => void;
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
      printer: { via: null, autoPrint: false },
      hideWorth: false,
      setLocale: (locale) => set({ locale }),
      setNumerals: (numerals) => set({ numerals }),
      setReceiptPaper: (receiptPaper) => set({ receiptPaper }),
      setPrinter: (printer) =>
        set((s) => ({ printer: { ...s.printer, ...printer } })),
      clearPrinter: () =>
        set((s) => ({
          printer: { via: null, autoPrint: s.printer.autoPrint },
        })),
      setHideWorth: (hideWorth) => set({ hideWorth }),
    }),
    { name: "sa.prefs", version: 1 },
  ),
);
