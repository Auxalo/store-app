import { NextResponse } from "next/server";
import { getSyncDeps } from "@/server/deps";
import { revokeDevice } from "@/server/devices";
import { errorResponse, HttpError } from "@/server/http";
import { requireUser } from "@/server/session";

export const dynamic = "force-dynamic";

/** Cuts a lost or stolen device off from syncing. Work still waiting on that device stays on it. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const owner = await requireUser(request, "settings.manage");
    const { id } = await params;
    const { db } = await getSyncDeps();
    if (!(await revokeDevice(db, owner.storeId, id)))
      throw new HttpError(404, "NOT_FOUND");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
