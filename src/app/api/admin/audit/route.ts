import { NextResponse } from "next/server";
import { getDb } from "@/db/server/mongo";
import { errorResponse } from "@/server/http";
import { requirePlatformAdmin } from "@/server/platform-admin";

export const dynamic = "force-dynamic";

import { recentAdminActions } from "@/server/admin-shops";

/** What operators did (pauses, resumes, password resets, exports), newest first. */
export async function GET(request: Request) {
  try {
    await requirePlatformAdmin(request);
    return NextResponse.json({
      actions: await recentAdminActions(await getDb()),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
