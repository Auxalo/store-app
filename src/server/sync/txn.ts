import type { ClientSession, Db, MongoClient } from "mongodb";
import { COL } from "./collections";

/** Runs `fn` in a transaction, retrying transient failures (the driver handles the retry loop). */
export async function withTxn<T>(
  client: MongoClient,
  fn: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = client.startSession();
  try {
    let result!: T;
    await session.withTransaction(
      async () => {
        result = await fn(session);
      },
      { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
    );
    return result;
  } finally {
    await session.endSession();
  }
}

/**
 * Reserves `count` consecutive sync sequence numbers for a store.
 *
 * Every write bumps the store document, so concurrent writers to one store serialize on it:
 * sequence order equals commit order. That is what lets a pull cursor never skip a write.
 */
export async function allocSeq(
  db: Db,
  session: ClientSession,
  storeId: string,
  count = 1,
): Promise<number> {
  const store = await db
    .collection<{ _id: string; syncSeq: number }>(COL.stores)
    .findOneAndUpdate(
      { _id: storeId },
      { $inc: { syncSeq: count } },
      { returnDocument: "after", session },
    );
  if (!store) throw new Error("STORE_NOT_FOUND");
  return store.syncSeq - count + 1;
}
