import type { StoreDB } from "./db";

/**
 * Removes the shop's data from this device after signing out: products, sales, customers, people
 * and their PIN checks, the queue, the cart, everything. Only the device's own identity and which
 * shop it belongs to are kept (a different shop signing in next then gets a new identity, and the
 * same shop simply downloads its data again). Nothing of one shop can be seen by the next person.
 */
export async function clearShopData(db: StoreDB): Promise<void> {
  const keep = (
    await db.syncMeta.bulkGet(["deviceId", "deviceCode", "storeId"])
  ).filter((row): row is NonNullable<typeof row> => row !== undefined);
  await db.transaction("rw", db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
    await db.syncMeta.bulkPut(keep);
  });
}

/** Work on this device that has not reached the server (waiting, failed or in conflict). */
export function unsentCount(db: StoreDB): Promise<number> {
  return db.outbox
    .where("status")
    .anyOf("pending", "syncing", "failed", "conflict")
    .count();
}
