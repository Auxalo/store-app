import type { Db } from "mongodb";
import { type BillingDoc, type BillingStamp, stampOf } from "@/billing/state";
import { caches } from "./cache";

export type ShopStatus = "active" | "suspended";

/** What every request needs to know about the shop before doing anything for it. */
export interface ShopGate {
  status: ShopStatus;
  billing: BillingDoc | null;
}

/**
 * The shop's status and billing, in one read. Remembered for a few seconds, like the other
 * per-request lookups; the server that changes either forgets it at once (`clearStoreCaches`).
 */
export async function shopGate(db: Db, storeId: string): Promise<ShopGate> {
  const gate = (await caches.gate.load(storeId, async () => {
    const store = await db
      .collection<{ _id: string; status?: string; billing?: BillingDoc }>(
        "stores",
      )
      .findOne({ _id: storeId }, { projection: { status: 1, billing: 1 } });
    return {
      status: store?.status === "suspended" ? "suspended" : "active",
      billing: store?.billing ?? null,
    } satisfies ShopGate;
  })) as ShopGate | undefined;
  return gate ?? { status: "active", billing: null };
}

/**
 * Is this shop paused by the operator? A paused shop's devices and sign-ins are refused by every
 * endpoint (403 SHOP_SUSPENDED) and the app shows who to contact.
 */
export async function shopStatus(db: Db, storeId: string): Promise<ShopStatus> {
  return (await shopGate(db, storeId)).status;
}

export async function shopIsSuspended(
  db: Db,
  storeId: string,
): Promise<boolean> {
  return (await shopStatus(db, storeId)) === "suspended";
}

/** The shop's billing as a device is told it (head, pull, and the 402 of billing-gate.ts carry it). */
export async function billingStamp(
  db: Db,
  storeId: string,
  now = new Date(),
): Promise<BillingStamp> {
  return stampOf((await shopGate(db, storeId)).billing, now);
}
