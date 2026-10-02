import type { StoreDB } from "@/db/local/db";
import { getMeta, setMeta } from "@/db/local/meta";

/**
 * How this device gets its data.
 *   online  : screens ask the server directly (search, filter, infinite scroll). The default for a new device.
 *   offline : the whole shop is downloaded to the device first and everything works with no internet.
 * It is a per-device choice, kept with the device's data (and mirrored to localStorage so the very
 * first paint already knows it).
 */
export type DataMode = "online" | "offline";

export const MODE_STORAGE_KEY = "sa.dataMode";

const isMode = (value: unknown): value is DataMode =>
  value === "online" || value === "offline";

/** The remembered mode, read synchronously (for the first paint). Null when nothing is remembered. */
export function readStoredMode(): DataMode | null {
  try {
    const value = globalThis.localStorage?.getItem(MODE_STORAGE_KEY);
    return isMode(value) ? value : null;
  } catch {
    return null;
  }
}

function mirror(mode: DataMode) {
  try {
    globalThis.localStorage?.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    /* private window or blocked storage: the device database still has it */
  }
}

/**
 * What this device should use. A device that has already worked offline (it has downloaded data, or
 * has changes waiting to be sent) keeps working offline, so nobody's data or queue is stranded by an
 * update. Only a brand-new device starts online.
 */
export async function resolveDataMode(db: StoreDB): Promise<DataMode> {
  const saved = await getMeta(db, "dataMode");
  if (isMode(saved)) {
    mirror(saved);
    return saved;
  }
  const hasDownloaded = (await getMeta(db, "cursor")) !== undefined;
  const hasQueue = (await db.outbox.count()) > 0;
  const mode: DataMode = hasDownloaded || hasQueue ? "offline" : "online";
  await setMeta(db, "dataMode", mode);
  mirror(mode);
  return mode;
}

export async function setDataMode(db: StoreDB, mode: DataMode): Promise<void> {
  await setMeta(db, "dataMode", mode);
  mirror(mode);
}
