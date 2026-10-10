import { NextResponse } from "next/server";
import { createStaffSchema } from "@/schemas/staff";
import { requireActor } from "@/server/actor-request";
import { getSyncDeps } from "@/server/deps";
import { checkDevice } from "@/server/devices";
import { errorResponse, HttpError, readJson } from "@/server/http";
import { requireUser } from "@/server/session";
import { listStaff } from "@/server/staff";
import { createStaffMember } from "@/server/staff-admin";

export const dynamic = "force-dynamic";
// A small request: stop it early rather than let it hold a function instance.
export const maxDuration = 10;

/**
 * The store's people, for the "who is working?" screen. Devices call this with their device cookie
 * (so it works for a shared counter whose login session has expired); the owner's screens may use
 * their session instead. A person's PIN hash (so their PIN can be checked offline) is included only
 * for a device that may hold it: see listStaff.
 */
export async function GET(request: Request) {
  try {
    const { db } = await getSyncDeps();
    const device = await checkDevice(db, request.headers.get("cookie"));
    const signedIn = device.ok ? null : await requireUser(request);
    const storeId = device.ok ? device.device.storeId : signedIn?.storeId;
    if (!storeId) throw new HttpError(401, "UNAUTHORIZED");
    // Who is asking decides whose PIN hash comes along (see listStaff).
    return NextResponse.json({
      staff: await listStaff(
        db,
        storeId,
        device.ok ? { device: device.device } : { userId: signedIn?.id },
      ),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Owner adds a manager or cashier. */
export async function POST(request: Request) {
  try {
    const owner = await requireActor(request, "user.manage", {
      allowLocked: true,
    });
    const body = createStaffSchema.parse(await readJson(request));
    const { db } = await getSyncDeps();
    const member = await createStaffMember(db, owner.storeId, body);
    return NextResponse.json({ staff: member }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "USERNAME_TAKEN") {
      return errorResponse(new HttpError(409, "USERNAME_TAKEN"));
    }
    return errorResponse(error);
  }
}
