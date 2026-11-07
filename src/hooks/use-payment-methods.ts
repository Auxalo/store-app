"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import { useCommand } from "@/data/hooks";
import { useDataModeStore } from "@/data/mode-store";
import { applyServerDocs } from "@/db/local/apply-server";
import { getLocalDb } from "@/db/local/db";
import {
  METHOD_KEY_PREFIX,
  makeMethodHelpers,
  methodRecordsFromSettings,
} from "@/lib/payment-methods";

/**
 * The shop's payment methods (built-in and its own). Read from the device database in both modes,
 * like every shop setting, so a screen never waits for it and it works offline. Until it has loaded,
 * the built-in methods show as shipped.
 */
export function usePaymentMethods() {
  const t = useTranslations("payment");
  const rows = useLiveQuery(
    () =>
      getLocalDb().settings.where("id").startsWith(METHOD_KEY_PREFIX).toArray(),
    [],
  );
  return useMemo(
    () =>
      makeMethodHelpers(methodRecordsFromSettings(rows ?? []), (code) =>
        t(code as never),
      ),
    [rows, t],
  );
}

/**
 * Saves one method (add, rename, hide, show). Online, the saved record is also put on the device so
 * every screen shows it at once (the same as saving any shop setting).
 */
export function useSaveMethod() {
  const run = useCommand();
  return useCallback(
    async (input: { code: string; name: string; removed: boolean }) => {
      const outcome = await run("paymentMethod.save", input);
      if (useDataModeStore.getState().mode !== "online") return;
      const docs = (outcome.docs ?? [])
        .filter((c) => c.collection === "settings")
        .map((c) => c.doc);
      await getLocalDb().transaction("rw", getLocalDb().tables, () =>
        applyServerDocs(getLocalDb(), "settings", docs),
      );
    },
    [run],
  );
}
