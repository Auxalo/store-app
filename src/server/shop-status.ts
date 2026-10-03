import type { Db } from "mongodb";
import { caches } from "./cache";

export type ShopStatus = "active" | "suspended";

/**
 * Is this shop paused by the operator? A paused shop's devices and sign-ins are refused by every
 * endpoint (403 SHOP_SUSPENDED) and the app shows who to contact. Remembered for a few seconds, like
 * the other per-request lookups; the server that pauses or resumes a shop forgets it at once.
 */
export async function shopStatus(db: Db, storeId: string): Promise<ShopStatus> {
  const status = await caches.status.load(storeId, async () => {
    const store = await db
      .collection<{ _id: string; status?: string }>("stores")
      .findOne({ _id: storeId }, { projection: { status: 1 } });
    return store?.status === "suspended" ? "suspended" : "active";
  });
  return status === "suspended" ? "suspended" : "active";
}

export async function shopIsSuspended(
  db: Db,
  storeId: string,
): Promise<boolean> {
  return (await shopStatus(db, storeId)) === "suspended";
}
