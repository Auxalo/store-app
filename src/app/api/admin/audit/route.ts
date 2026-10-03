import { NextResponse } from "next/server";
import { getDb } from "@/db/server/mongo";
import { errorResponse } from "@/server/http";
import { requirePlatformAdmin } from "@/server/platform-admin";

export const dynamic = "force-dynamic";

import { recentAdminActions } from "@/server/admin-shops";

/** What operators did (billing, pauses, password resets, exports), newest first; or for one shop. */
export async function GET(request: Request) {
  try {
    await requirePlatformAdmin(request);
    const storeId = new URL(request.url).searchParams.get("storeId");
    return NextResponse.json({
      actions: await recentAdminActions(
        await getDb(),
        200,
        storeId ? storeId.slice(0, 64) : undefined,
      ),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
