import { DataError } from "@/data/errors";
import { getLastHead } from "@/data/head";
import { fetchAll } from "@/data/online";
import { applyServerDocs } from "@/db/local/apply-server";
import type { StoreDB } from "@/db/local/db";
import { setMeta } from "@/db/local/meta";
import type { WireDoc } from "@/schemas/sync";
import { type EngineOptions, pushAll } from "./engine";
import { useSyncStore } from "./store";
import { type SyncTransport, TransportError } from "./transport";

/** The change counter the settings on this device were fetched at. */
let lastSettingsHead: number | null = null;

/**
 * What syncing means while this device is online: it does NOT download the shop. It only
 *   1. sends anything still waiting in the queue (changes made before the device went online),
 *   2. fetches the shop's settings, which the receipt, the idle lock and a few screens read locally.
 * Everything else is read from the server when a screen asks for it.
 */
export async function syncOnlineOnce(
  db: StoreDB,
  transport: SyncTransport,
  options: EngineOptions,
): Promise<{ pushed: number }> {
  const { sent } = await pushAll(db, transport, options);
  // Settings are saved records, so they move the shop's change counter: they are fetched only when
  // that has moved since the last time (a quiet minute costs no request at all). While something is
  // wrong (the shop is paused, the server was unreachable...) the server is asked every time: a
  // cycle that asked nobody must not be what clears the problem.
  const head = getLastHead();
  const quiet = useSyncStore.getState().problem === null;
  if (quiet && head !== null && head === lastSettingsHead) {
    await setMeta(db, "lastSyncAt", (options.now ?? Date.now)());
    return { pushed: sent };
  }
  try {
    const settings = (await fetchAll("settings")) as unknown as WireDoc[];
    await db.transaction("rw", db.tables, () =>
      applyServerDocs(db, "settings", settings),
    );
    lastSettingsHead = head;
  } catch (error) {
    if (!(error instanceof DataError)) throw error;
    throw new TransportError(
      error.status === 0
        ? "network"
        : error.code === "SHOP_SUSPENDED"
          ? "suspended"
          : error.status === 401 || error.status === 403
            ? "auth"
            : "server",
      error.code,
      error.status,
    );
  }
  await setMeta(db, "lastSyncAt", (options.now ?? Date.now)());
  return { pushed: sent };
}
