import type { StoreDB } from "@/db/local/db";
import { getMeta, setMeta } from "@/db/local/meta";

const DAY_MS = 86_400_000;
/** Operations the server has accepted are only kept this long (for troubleshooting). */
export const KEEP_SYNCED_DAYS = 7;
const PRUNE_EVERY_MS = DAY_MS;

/**
 * Deletes operations that were sent and accepted a while ago, so the queue does not grow forever on
 * a phone with little storage. Anything that has not reached the server (pending, failed,
 * conflict) is never touched, and neither are the business records themselves.
 */
export async function pruneOutbox(
  db: StoreDB,
  now = Date.now(),
): Promise<number> {
  const cutoff = now - KEEP_SYNCED_DAYS * DAY_MS;
  const old = await db.outbox
    .where("status")
    .equals("synced")
    .filter((op) => (op.syncedAt ?? 0) < cutoff)
    .primaryKeys();
  if (old.length > 0) await db.outbox.bulkDelete(old);
  return old.length;
}

/** Prunes at most once a day. Call after a successful sync. */
export async function pruneIfDue(
  db: StoreDB,
  now = Date.now(),
): Promise<number> {
  const last = (await getMeta(db, "lastPruneAt")) ?? 0;
  if (now - last < PRUNE_EVERY_MS) return 0;
  const removed = await pruneOutbox(db, now);
  await setMeta(db, "lastPruneAt", now);
  return removed;
}
