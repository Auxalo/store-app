import { NextResponse } from "next/server";
import { getDb } from "@/db/server/mongo";
import { errorResponse, HttpError } from "@/server/http";
import { requirePlatformAdmin } from "@/server/platform-admin";

export const dynamic = "force-dynamic";

import { shopDetail } from "@/server/admin-shops";

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
