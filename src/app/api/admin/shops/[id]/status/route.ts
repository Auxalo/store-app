import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/server/mongo";
import { errorResponse, HttpError, readJson } from "@/server/http";
import { requirePlatformAdmin } from "@/server/platform-admin";

export const dynamic = "force-dynamic";

import { setShopStatus } from "@/server/admin-shops";

const bodySchema = z.object({ status: z.enum(["active", "suspended"]) });

/** Pauses a shop (its devices and sign-ins are refused, the app says who to contact) or resumes it. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requirePlatformAdmin(request);
    const { id } = await params;
    const { status } = bodySchema.parse(await readJson(request));
    if (!(await setShopStatus(await getDb(), admin, id, status)))
      throw new HttpError(404, "NOT_FOUND");
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    return errorResponse(error);
  }
}
