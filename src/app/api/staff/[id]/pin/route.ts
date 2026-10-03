import { NextResponse } from "next/server";
import { can } from "@/auth/permissions";
import { setPinSchema } from "@/schemas/staff";
import { requireActor } from "@/server/actor-request";
import { getSyncDeps } from "@/server/deps";
import { errorResponse, HttpError, readJson } from "@/server/http";
import { setStaffPin } from "@/server/staff";

export const dynamic = "force-dynamic";

/** Stores a PIN hash: the owner may set anyone's, everyone may set their own. */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireActor(request, undefined, {
      allowLocked: true,
    });
    const { id } = await params;
    if (id !== user.id && !can(user.role, "user.manage"))
      throw new HttpError(403, "FORBIDDEN");
    const pin = setPinSchema.parse(await readJson(request));
    const { db } = await getSyncDeps();
    const result = await setStaffPin(db, user.storeId, id, pin);
    if (!result.ok) throw new HttpError(404, result.error);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
