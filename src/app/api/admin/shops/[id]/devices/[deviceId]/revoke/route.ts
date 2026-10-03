import { NextResponse } from "next/server";
import { getDb } from "@/db/server/mongo";
import { logAdminAction } from "@/server/admin-shops";
import { revokeDevice } from "@/server/devices";
import { errorResponse, HttpError } from "@/server/http";
import { requirePlatformAdmin } from "@/server/platform-admin";

export const dynamic = "force-dynamic";

/** Stops a lost or stolen device of the shop from using it (its data on the device stays there). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; deviceId: string }> },
) {
  try {
    const admin = await requirePlatformAdmin(request);
    const { id, deviceId } = await params;
    const db = await getDb();
    if (!(await revokeDevice(db, id, deviceId)))
      throw new HttpError(404, "NOT_FOUND");
    await logAdminAction(db, admin, "device.revoke", id, deviceId.slice(0, 8));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
