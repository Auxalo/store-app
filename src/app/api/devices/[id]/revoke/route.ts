import { NextResponse } from "next/server";
import { requireActor } from "@/server/actor-request";
import { getSyncDeps } from "@/server/deps";
import { revokeDevice } from "@/server/devices";
import { errorResponse, HttpError } from "@/server/http";

export const dynamic = "force-dynamic";
// A small request: stop it early rather than let it hold a function instance.
export const maxDuration = 10;

/** Cuts a lost or stolen device off from syncing. Work still waiting on that device stays on it. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const owner = await requireActor(request, "settings.manage", {
      allowLocked: true,
    });
    const { id } = await params;
    const { db } = await getSyncDeps();
    if (!(await revokeDevice(db, owner.storeId, id)))
      throw new HttpError(404, "NOT_FOUND");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
