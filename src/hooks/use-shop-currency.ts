"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { getLocalDb } from "@/db/local/db";
import {
  CURRENCY_SETTING_KEY,
  type CurrencyCode,
  currencyCodeOf,
} from "@/lib/currency";

/**
 * The currency saved in the shop's settings, read from the device database (so it works offline).
 * undefined while loading; taka when the shop never chose one.
 */
export function useSavedCurrency(): CurrencyCode | undefined {
  const row = useLiveQuery(
    async () => (await getLocalDb().settings.get(CURRENCY_SETTING_KEY)) ?? null,
    [],
  );
  return row === undefined ? undefined : currencyCodeOf(row?.value);
}
