import { NextResponse } from "next/server";
import { z } from "zod";
import { getSyncDeps } from "@/server/deps";
import { requireDevice } from "@/server/device-request";
import { errorResponse } from "@/server/http";
import { billingStamp } from "@/server/shop-status";
import { handlePull } from "@/server/sync/pull";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  cursor: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

/** Returns changes made by any device after `cursor`, and the shop's billing. */
export async function GET(request: Request) {
  try {
    const { db } = await getSyncDeps();
    const device = await requireDevice(request, db, "read");

    const query = querySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const [page, billing] = await Promise.all([
      handlePull(db, device.storeId, query.cursor, query.limit),
      billingStamp(db, device.storeId),
    ]);
    return NextResponse.json({ ...page, billing });
  } catch (error) {
    return errorResponse(error);
  }
}
