import "server-only";
import { getDb, getMongoClient } from "@/db/server/mongo";
import { ensureSyncIndexes } from "./sync/collections";
import type { SyncDeps } from "./sync/push";

const g = globalThis as unknown as { __syncDeps?: Promise<SyncDeps> };

/**
 * Real database handles for route handlers (tests pass their own into the sync functions).
 *
 * Built once per server process: the connection, the database handle, and the check that the
 * indexes exist. (This used to run on every call, and the index check re-sent about 57 commands to
 * the database each time, up to three times per request.) After running `pnpm db:indexes` as part
 * of a deploy, set SKIP_RUNTIME_INDEXES=1 to skip the check at start-up as well.
 */
export function getSyncDeps(): Promise<SyncDeps> {
  g.__syncDeps ??= (async () => {
    const client = await getMongoClient();
    const db = await getDb();
    if (process.env.SKIP_RUNTIME_INDEXES !== "1") await ensureSyncIndexes(db);
    return { client, db };
  })().catch((error) => {
    g.__syncDeps = undefined; // try again on the next request
    throw error;
  });
  return g.__syncDeps;
}
