import { NextResponse } from "next/server";
import { z } from "zod";
import { getSyncDeps } from "@/server/deps";
import { renameDevice } from "@/server/devices";
import { errorResponse, HttpError, readJson } from "@/server/http";
import { requireUser } from "@/server/session";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ name: z.string().trim().min(1).max(60) });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const owner = await requireUser(request, "settings.manage");
    const { id } = await params;
    const { name } = bodySchema.parse(await readJson(request));
    const { db } = await getSyncDeps();
    if (!(await renameDevice(db, owner.storeId, id, name)))
      throw new HttpError(404, "NOT_FOUND");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
