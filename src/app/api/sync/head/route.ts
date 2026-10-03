import { NextResponse } from "next/server";
import type { BillingDoc } from "@/billing/state";
import { stampWithPlan } from "@/server/billing-settings";
import { getSyncDeps } from "@/server/deps";
import { requireDevice } from "@/server/device-request";
import { errorResponse } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * How far this shop changes have got (one number). Online screens poll it cheaply and refresh
 * only when it moves, so changes made on another device show up without constant re-fetching.
 * It also carries the shop's billing, read fresh, so a renewal or a lock reaches every device.
 */
export async function GET(request: Request) {
  try {
    const { db } = await getSyncDeps();
    const device = await requireDevice(request, db, "read");
    const store = await db
      .collection<{ _id: string; syncSeq?: number; billing?: BillingDoc }>(
        "stores",
      )
      .findOne(
        { _id: device.storeId },
        { projection: { syncSeq: 1, billing: 1 } },
      );
    return NextResponse.json({
      syncSeq: store?.syncSeq ?? 0,
      billing: await stampWithPlan(db, store?.billing),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
