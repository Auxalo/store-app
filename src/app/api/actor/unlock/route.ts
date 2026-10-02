import { NextResponse } from "next/server";
import { z } from "zod";
import { serverEnv } from "@/lib/env";
import { ACTOR_COOKIE, unlockActor } from "@/server/actor";
import { getSyncDeps } from "@/server/deps";
import { checkDevice } from "@/server/devices";
import { errorResponse, HttpError, readJson } from "@/server/http";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  userId: z.string().min(1).max(64),
  pin: z.string().min(1).max(12),
});

/**
 * Online PIN unlock: the server checks the PIN (with the same wrong-PIN waiting rules as the
 * device) and, if it is right, sets a signed cookie saying who is working on this device.
 */
export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await readJson(request));
    const { db } = await getSyncDeps();
    const device = await checkDevice(db, request.headers.get("cookie"));
    if (!device.ok) throw new HttpError(401, "DEVICE_UNKNOWN");

    const result = await unlockActor(db, {
      storeId: device.device.storeId,
      deviceId: device.device.deviceId,
      userId: body.userId,
      pin: body.pin,
      secret: serverEnv().BETTER_AUTH_SECRET,
    });
    if (!result.ok) {
      const status =
        result.reason === "LOCKED" || result.reason === "NEEDS_PASSWORD"
          ? 429
          : 401;
      return NextResponse.json(
        {
          code: result.reason,
          waitMs: result.waitMs,
          freeLeft: result.freeLeft,
        },
        { status },
      );
    }
    const response = NextResponse.json({ userId: result.userId });
    response.cookies.set(ACTOR_COOKIE, result.cookieValue, {
      httpOnly: true,
      sameSite: "lax",
      secure: new URL(request.url).protocol === "https:",
      path: "/",
      maxAge: result.maxAgeSeconds,
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
