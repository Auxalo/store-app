"use client";

import { useMemo } from "react";
import type { CurrencyCode } from "@/lib/currency";
import { createFormat } from "@/lib/format";
import { usePreferences } from "@/stores/preferences";

/**
 * Locale/numeral/timezone-aware formatters for money, quantities and dates. Money follows the
 * shop's currency; pass one to show amounts in a fixed currency instead (the app's own billing is
 * always in taka).
 */
export function useFormat(currency?: CurrencyCode) {
  const locale = usePreferences((s) => s.locale);
  const numerals = usePreferences((s) => s.numerals);
  const timeZone = usePreferences((s) => s.timeZone);
  const shopCurrency = usePreferences((s) => s.currency);
  const code = currency ?? shopCurrency;
  return useMemo(
    () => createFormat({ locale, numerals, timeZone, currency: code }),
    [locale, numerals, timeZone, code],
  );
}
