"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useCallback } from "react";
import { useCommand } from "@/data/hooks";
import { useDataModeStore } from "@/data/mode-store";
import { applyServerDocs } from "@/db/local/apply-server";
import { getLocalDb } from "@/db/local/db";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/**
 * A store-wide setting (synced to every device). It is read from the device database in both
 * modes (online mode keeps the settings fresh there on every sync cycle), so screens never wait.
 * Offline mode writes through the normal queued command. Online mode saves on the server and then
 * puts the saved value on the device so the screen shows it at once.
 */
export function useSetting<T extends Json>(key: string, fallback: T) {
  const run = useCommand();
  const row = useLiveQuery(() => getLocalDb().settings.get(key), [key]);
  const value = (row?.value as T | undefined) ?? fallback;
  const set = useCallback(
    async (next: T) => {
      const outcome = await run("setting.set", { key, value: next });
      if (useDataModeStore.getState().mode !== "online") return;
      const docs = (outcome.docs ?? [])
        .filter((c) => c.collection === "settings")
        .map((c) => c.doc);
      await getLocalDb().transaction("rw", getLocalDb().tables, () =>
        applyServerDocs(getLocalDb(), "settings", docs),
      );
    },
    [run, key],
  );
  return { value, set };
}
