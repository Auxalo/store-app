import { NextResponse } from "next/server";
import { getDb } from "@/db/server/mongo";
import { listDevices } from "@/server/devices";
import { errorResponse } from "@/server/http";
import { requirePlatformAdmin } from "@/server/platform-admin";

export const dynamic = "force-dynamic";

/** The shop's devices: name, when each was last used, which are revoked. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requirePlatformAdmin(request);
    const { id } = await params;
    return NextResponse.json({ devices: await listDevices(await getDb(), id) });
  } catch (error) {
    return errorResponse(error);
  }
}
