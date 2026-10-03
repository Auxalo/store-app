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

/**
 * The store's people, for the "who is working?" screen. Devices call this with their device cookie
 * (so it works for a shared counter whose login session has expired); the owner's screens may use
 * their session instead. It includes each person's PIN hash so a PIN can be checked offline.
 */
export async function GET(request: Request) {
  try {
    const { db } = await getSyncDeps();
    const device = await checkDevice(db, request.headers.get("cookie"));
    const storeId = device.ok
      ? device.device.storeId
      : (await requireUser(request)).storeId;
    return NextResponse.json({ staff: await listStaff(db, storeId) });
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
