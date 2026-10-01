"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useCallback } from "react";
import { getLocalDb } from "@/db/local/db";
import { useCommands } from "@/sync/use-commands";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/**
 * A store-wide setting (synced to every device). Reads from the device database, so it works
 * offline; writing goes through the normal queued command, so it syncs like everything else.
 */
export function useSetting<T extends Json>(key: string, fallback: T) {
  const run = useCommands();
  const row = useLiveQuery(() => getLocalDb().settings.get(key), [key]);
  const value = (row?.value as T | undefined) ?? fallback;
  const set = useCallback(
    (next: T) => run("setting.set", { key, value: next }),
    [run, key],
  );
  return { value, set };
}
