import { NextResponse } from "next/server";
import { getSyncDeps } from "@/server/deps";
import { checkDevice } from "@/server/devices";
import { errorResponse, HttpError } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * How far this shop changes have got (one number). Online screens poll it cheaply and refresh
 * only when it moves, so changes made on another device show up without constant re-fetching.
 */
export async function GET(request: Request) {
  try {
    const { db } = await getSyncDeps();
    const device = await checkDevice(db, request.headers.get("cookie"));
    if (!device.ok) throw new HttpError(401, "DEVICE_UNKNOWN");
    const store = await db
      .collection<{ _id: string; syncSeq?: number }>("stores")
      .findOne({ _id: device.device.storeId }, { projection: { syncSeq: 1 } });
    return NextResponse.json({ syncSeq: store?.syncSeq ?? 0 });
  } catch (error) {
    return errorResponse(error);
  }
}
