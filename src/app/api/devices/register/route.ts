import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "@/auth/server";
import { isFreshSession, setPasswordActor } from "@/server/actor-grant";
import { getSyncDeps } from "@/server/deps";
import {
  checkDevice,
  DEVICE_COOKIE,
  noteDeviceUnlock,
  registerDevice,
} from "@/server/devices";
import { errorResponse, HttpError, readJson } from "@/server/http";
import { shopIsSuspended } from "@/server/shop-status";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  deviceId: z.uuid(),
  name: z.string().trim().min(1).max(60).default("Device"),
});

/**
 * Makes this browser a trusted device of the signed-in user's store. The device cookie lets the
 * sync endpoints keep working after the login session expires (a shared shop terminal).
 */
export async function POST(request: Request) {
  try {
    const auth = await getAuth();
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new HttpError(401, "UNAUTHORIZED");
    const user = session.user as {
      id: string;
      storeId: string;
      isActive?: boolean;
    };
    if (user.isActive === false) throw new HttpError(403, "USER_INACTIVE");

    const body = bodySchema.parse(await readJson(request));
    const { db } = await getSyncDeps();
    // The session cookie remembers the person for a few minutes; ask the database, so someone
    // deactivated a moment ago cannot register a new device.
    const live = ObjectId.isValid(user.id)
      ? await db.collection("user").findOne({ _id: new ObjectId(user.id) })
      : null;
    if (!live || live.isActive === false || live.platformAdmin === true)
      throw new HttpError(403, "USER_INACTIVE");
    // A paused shop cannot add devices (the app then shows who to contact).
    if (await shopIsSuspended(db, user.storeId))
      throw new HttpError(403, "SHOP_SUSPENDED");
    const existing = await checkDevice(db, request.headers.get("cookie"));
    const registration = await registerDevice(db, {
      storeId: user.storeId,
      userId: user.id,
      deviceId: body.deviceId,
      name: body.name,
      existing,
    });

    // Signing in with the password is as good as the PIN: this device may hold this person's PIN hash.
    await noteDeviceUnlock(db, body.deviceId, user.id);

    const response = NextResponse.json({ code: registration.code });
    // A device registered right after the password was typed: that person is the one working.
    if (isFreshSession(session.session.createdAt))
      setPasswordActor(response, request, {
        userId: user.id,
        deviceId: body.deviceId,
      });
    if (registration.token) {
      response.cookies.set(
        DEVICE_COOKIE,
        `${body.deviceId}.${registration.token}`,
        {
          httpOnly: true,
          sameSite: "lax",
          secure: new URL(request.url).protocol === "https:",
          path: "/",
          maxAge: 60 * 60 * 24 * 365,
        },
      );
    }
    return response;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("DEVICE_")) {
      return errorResponse(new HttpError(403, error.message));
    }
    return errorResponse(error);
  }
}
