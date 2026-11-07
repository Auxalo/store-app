"use client";

import { useEffect } from "react";
import { useSavedCurrency } from "@/hooks/use-shop-currency";
import { usePreferences } from "@/stores/preferences";

/**
 * Keeps the device's copy of the shop's currency (used to show money at first paint) in step with
 * the shop's synced setting. A shop that never chose one is in taka.
 */
export function CurrencySync() {
  const saved = useSavedCurrency();
  const setCurrency = usePreferences((s) => s.setCurrency);
  useEffect(() => {
    if (saved) setCurrency(saved);
  }, [saved, setCurrency]);
  return null;
}
