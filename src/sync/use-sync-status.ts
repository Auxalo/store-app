"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { getLocalDb } from "@/db/local/db";
import { useConnectivity } from "@/stores/connectivity";
import { useSyncStore } from "./store";

export type SyncIndicator =
  | "issue"
  | "offline"
  | "syncing"
  | "pending"
  | "synced";

const EMPTY = { pending: 0, failed: 0, conflict: 0 };

/** Everything the small global indicator and the sync screen need, live. */
export function useSyncStatus() {
  const online = useConnectivity((s) => s.online);
  const sync = useSyncStore();

  const counts =
    useLiveQuery(async () => {
      const { outbox } = getLocalDb();
      const [pending, failed, conflict] = await Promise.all([
        outbox.where("status").anyOf("pending", "syncing").count(),
        outbox.where("status").equals("failed").count(),
        outbox.where("status").equals("conflict").count(),
      ]);
      return { pending, failed, conflict };
    }, []) ?? EMPTY;

  const blocking =
    sync.problem === "auth" ||
    sync.problem === "upgrade" ||
    sync.problem === "suspended" ||
    sync.problem === "storeMismatch";
  // "Offline" means "cannot reach the server", whatever the browser's own online flag says.
  const unreachable = !online || sync.problem === "network";

  // Never claim "synced" until a sync has really completed on this device.
  const indicator: SyncIndicator =
    counts.failed > 0 ||
    counts.conflict > 0 ||
    blocking ||
    sync.problem === "server"
      ? "issue"
      : unreachable
        ? "offline"
        : sync.running || !sync.initialSyncDone
          ? "syncing"
          : counts.pending > 0
            ? "pending"
            : "synced";

  return { ...sync, ...counts, online, indicator };
}
