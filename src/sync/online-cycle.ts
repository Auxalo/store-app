import { DataError } from "@/data/errors";
import { fetchAll } from "@/data/online";
import { applyServerDocs } from "@/db/local/apply-server";
import type { StoreDB } from "@/db/local/db";
import { setMeta } from "@/db/local/meta";
import type { WireDoc } from "@/schemas/sync";
import { type EngineOptions, pushAll } from "./engine";
import { type SyncTransport, TransportError } from "./transport";

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
  try {
    const settings = (await fetchAll("settings")) as unknown as WireDoc[];
    await db.transaction("rw", db.tables, () =>
      applyServerDocs(db, "settings", settings),
    );
  } catch (error) {
    if (!(error instanceof DataError)) throw error;
    throw new TransportError(
      error.status === 0
        ? "network"
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
