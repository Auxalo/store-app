import type { Db } from "mongodb";
import { SYNC_COLLECTIONS, type SyncCollection } from "@/commands/definitions";
import type { PullChanges, PullResponse, WireDoc } from "@/schemas/sync";
import { toWire } from "../commands/master-data";
import { COL } from "./collections";

export const DEFAULT_PULL_LIMIT = 500;

const emptyChanges = (): PullChanges =>
  Object.fromEntries(
    SYNC_COLLECTIONS.map((c) => [c, []]),
  ) as unknown as PullChanges;

/**
 * Returns everything in the store that changed after `cursor`, oldest first, in pages.
 *
 * Reading the store's current counter first gives a stable upper bound: all sequence numbers up
 * to it are already committed (writers serialize on the counter), so no later-committing write
 * can appear below a cursor we hand out.
 */
export async function handlePull(
  db: Db,
  storeId: string,
  cursor: number,
  limit = DEFAULT_PULL_LIMIT,
): Promise<PullResponse> {
  const serverTime = new Date().toISOString();
  const store = await db
    .collection<{ _id: string; syncSeq: number; staffVersion?: number }>(
      COL.stores,
    )
    .findOne({ _id: storeId });
  const upper = store?.syncSeq ?? 0;
  if (cursor >= upper)
    return {
      serverTime,
      cursor: Math.max(cursor, upper),
      hasMore: false,
      changes: emptyChanges(),
      staffVersion: store?.staffVersion ?? 0,
    };

  const found: Array<{ collection: SyncCollection; doc: WireDoc }> = [];
  for (const collection of SYNC_COLLECTIONS) {
    const docs = await db
      .collection(collection)
      .find({ storeId, syncSeq: { $gt: cursor, $lte: upper } })
      .sort({ syncSeq: 1 })
      .limit(limit + 1)
      .toArray();
    for (const raw of docs) {
      const doc = toWire(raw as never);
      // Settings are stored under "<storeId>:<key>" but travel under their plain key.
      if (collection === "settings")
        doc.id = String((raw as unknown as { key: string }).key);
      found.push({ collection, doc });
    }
  }
  found.sort((a, b) => a.doc.syncSeq - b.doc.syncSeq);

  const hasMore = found.length > limit;
  const page = hasMore ? found.slice(0, limit) : found;
  const changes = emptyChanges();
  for (const { collection, doc } of page) changes[collection].push(doc);

  return {
    serverTime,
    cursor: hasMore ? (page.at(-1)?.doc.syncSeq ?? cursor) : upper,
    hasMore,
    changes,
    staffVersion: store?.staffVersion ?? 0,
  };
}
