import "server-only";
import { getMongoClient } from "@/db/server/mongo";
import { serverEnv } from "@/lib/env";
import { ensureSyncIndexes } from "./sync/collections";
import type { SyncDeps } from "./sync/push";

/** Real database handles for route handlers (tests pass their own into the sync functions). */
export async function getSyncDeps(): Promise<SyncDeps> {
  const client = await getMongoClient();
  const db = client.db(serverEnv().MONGODB_DB);
  await ensureSyncIndexes(db);
  return { client, db };
}
