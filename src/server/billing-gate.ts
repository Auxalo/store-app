import type { Db } from "mongodb";
import { billingStateOf } from "@/billing/state";
import { stampWithPlan } from "./billing-settings";
import { HttpError } from "./http";
import { shopGate } from "./shop-status";

/**
 * Refuses the shop's screens while its subscription is overdue past the grace days (402
 * BILLING_DUE, with the billing so the device can show it). Signing in, syncing, the PIN screen and
 * the billing page itself stay open: nothing typed on a device is lost, and the shop can pay.
 */
export async function assertBillingOpen(
  db: Db,
  storeId: string,
  now = new Date(),
): Promise<void> {
  const { billing } = await shopGate(db, storeId);
  if (billingStateOf(billing, now).locked)
    throw new HttpError(402, "BILLING_DUE", {
      billing: await stampWithPlan(db, billing, now),
    });
}
