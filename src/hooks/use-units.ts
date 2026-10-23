"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import { useCommand } from "@/data/hooks";
import { useDataModeStore } from "@/data/mode-store";
import { applyServerDocs } from "@/db/local/apply-server";
import { getLocalDb } from "@/db/local/db";
import {
  makeUnitHelpers,
  UNIT_KEY_PREFIX,
  unitRecordsFromSettings,
} from "@/lib/units";

/**
 * The shop's units (built-in and its own). Read from the device database in both modes, like every
 * shop setting, so a screen never waits for it and it works offline. Until it has loaded, the
 * built-in units show as shipped.
 */
export function useUnits() {
  const t = useTranslations("units");
  const rows = useLiveQuery(
    () =>
      getLocalDb().settings.where("id").startsWith(UNIT_KEY_PREFIX).toArray(),
    [],
  );
  return useMemo(
    () =>
      makeUnitHelpers(unitRecordsFromSettings(rows ?? []), (code) =>
        t(code as never),
      ),
    [rows, t],
  );
}

/**
 * Saves one unit (add, rename, change, remove, restore). Online, the saved record is also put on
 * the device so every screen shows it at once (the same as saving any shop setting).
 */
export function useSaveUnit() {
  const run = useCommand();
  return useCallback(
    async (input: {
      code: string;
      name: string;
      decimals: 0 | 1 | 2 | 3;
      removed: boolean;
    }) => {
      const outcome = await run("unit.save", input);
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
