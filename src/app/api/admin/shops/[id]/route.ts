import { NextResponse } from "next/server";
import { getDb } from "@/db/server/mongo";
import { shopProfileSchema } from "@/schemas/billing";
import { errorResponse, HttpError, readJson } from "@/server/http";
import { requirePlatformAdmin } from "@/server/platform-admin";

export const dynamic = "force-dynamic";

import { shopDetail, updateShopProfile } from "@/server/admin-shops";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requirePlatformAdmin(request);
    const { id } = await params;
    const detail = await shopDetail(await getDb(), id);
    if (!detail) throw new HttpError(404, "NOT_FOUND");
    return NextResponse.json({ shop: detail });
  } catch (error) {
    return errorResponse(error);
  }
}

/** The operator changes the shop's name, a phone to reach it, or their private notes about it. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requirePlatformAdmin(request);
    const { id } = await params;
    const patch = shopProfileSchema.parse(await readJson(request));
    if (!(await updateShopProfile(await getDb(), admin, id, patch)))
      throw new HttpError(404, "NOT_FOUND");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
