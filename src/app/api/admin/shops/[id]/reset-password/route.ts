import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/server/mongo";
import { errorResponse, HttpError, readJson } from "@/server/http";
import { requirePlatformAdmin } from "@/server/platform-admin";

export const dynamic = "force-dynamic";

import { passwordSchema } from "@/schemas/auth";
import { resetOwnerPassword } from "@/server/admin-shops";

const bodySchema = z.object({ password: passwordSchema });

/** Sets a new password for the shop's owner (a forgotten password has no other way back). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requirePlatformAdmin(request);
    const { id } = await params;
    const { password } = bodySchema.parse(await readJson(request));
    if (!(await resetOwnerPassword(await getDb(), admin, id, password)))
      throw new HttpError(404, "NOT_FOUND");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
