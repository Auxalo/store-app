import { NextResponse } from "next/server";
import { getDb } from "@/db/server/mongo";
import { billingOverview } from "@/server/admin-billing";
import { errorResponse } from "@/server/http";
import { requirePlatformAdmin } from "@/server/platform-admin";

export const dynamic = "force-dynamic";

/** The operator's first page: shops by billing state, payments to check, money in, shops to look at. */
export async function GET(request: Request) {
  try {
    await requirePlatformAdmin(request);
    return NextResponse.json(await billingOverview(await getDb()));
  } catch (error) {
    return errorResponse(error);
  }
}
