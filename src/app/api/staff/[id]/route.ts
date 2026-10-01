import { NextResponse } from "next/server";
import { updateStaffSchema } from "@/schemas/staff";
import { getSyncDeps } from "@/server/deps";
import { errorResponse, HttpError, readJson } from "@/server/http";
import { requireUser } from "@/server/session";
import { updateStaffMember } from "@/server/staff-admin";

export const dynamic = "force-dynamic";

/** Owner changes a name, role, active flag or password. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const owner = await requireUser(request, "user.manage");
    const { id } = await params;
    const patch = updateStaffSchema.parse(await readJson(request));
    const { db } = await getSyncDeps();
    const result = await updateStaffMember(db, owner.storeId, id, patch);
    if (!result.ok)
      throw new HttpError(
        result.error === "NOT_FOUND" ? 404 : 403,
        result.error,
      );
    return NextResponse.json({ staff: result.member });
  } catch (error) {
    return errorResponse(error);
  }
}
