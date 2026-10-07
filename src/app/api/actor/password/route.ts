import { NextResponse } from "next/server";
import { getAuth } from "@/auth/server";
import { isFreshSession, setPasswordActor } from "@/server/actor-grant";
import { getSyncDeps } from "@/server/deps";
import { checkDevice, noteDeviceUnlock } from "@/server/devices";
import { errorResponse, HttpError } from "@/server/http";
import { requireUser } from "@/server/session";

export const dynamic = "force-dynamic";

/**
 * Called right after someone signs in with their password: that person becomes the one working on
 * this device, even if they have no PIN (otherwise a PIN-less owner in a shop where staff have PINs
 * is asked for a PIN they do not have, for ever). Only a sign-in that has just happened counts.
 * On a device the server does not know yet nothing is done: registering it does the same.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const session = await (await getAuth()).api.getSession({
      headers: request.headers,
    });
    if (!session || !isFreshSession(session.session.createdAt))
      throw new HttpError(403, "SESSION_NOT_FRESH");

    const { db } = await getSyncDeps();
    const device = await checkDevice(db, request.headers.get("cookie"));
    if (!device.ok || device.device.storeId !== user.storeId)
      return NextResponse.json({ granted: false });

    await noteDeviceUnlock(db, device.device.deviceId, user.id);
    const response = NextResponse.json({ granted: true });
    setPasswordActor(response, request, {
      userId: user.id,
      deviceId: device.device.deviceId,
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
