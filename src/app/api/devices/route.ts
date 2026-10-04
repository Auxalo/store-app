import { NextResponse } from "next/server";
import { requireActor } from "@/server/actor-request";
import { getSyncDeps } from "@/server/deps";
import { checkDevice, listDevices } from "@/server/devices";
import { errorResponse } from "@/server/http";

export const dynamic = "force-dynamic";

/** The store's registered devices (owner only), marking the one asking. */
export async function GET(request: Request) {
  try {
    const owner = await requireActor(request, "settings.manage", {
      allowLocked: true,
    });
    const { db } = await getSyncDeps();
    const current = await checkDevice(db, request.headers.get("cookie"));
    const devices = await listDevices(db, owner.storeId);
    return NextResponse.json({
      devices: devices.map((d) => ({
        ...d,
        isThisDevice: current.ok && current.device.deviceId === d.id,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
