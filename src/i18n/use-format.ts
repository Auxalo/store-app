"use client";

import { useMemo } from "react";
import { createFormat } from "@/lib/format";
import { usePreferences } from "@/stores/preferences";

/** Locale/numeral/timezone-aware formatters for money, quantities and dates. */
export function useFormat() {
  const locale = usePreferences((s) => s.locale);
  const numerals = usePreferences((s) => s.numerals);
  const timeZone = usePreferences((s) => s.timeZone);
  return useMemo(
    () => createFormat({ locale, numerals, timeZone }),
    [locale, numerals, timeZone],
  );
}
