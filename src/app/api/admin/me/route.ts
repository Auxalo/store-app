import { NextResponse } from "next/server";
import { errorResponse } from "@/server/http";
import { requirePlatformAdmin } from "@/server/platform-admin";

export const dynamic = "force-dynamic";

/** Who the operator is (also how the admin page finds out whether this sign-in is one). */
export async function GET(request: Request) {
  try {
    return NextResponse.json({ admin: await requirePlatformAdmin(request) });
  } catch (error) {
    return errorResponse(error);
  }
}
