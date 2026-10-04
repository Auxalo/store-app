import { NextResponse } from "next/server";
import { approveSchema } from "@/schemas/billing";
import { approvePayment } from "@/server/billing";
import { getSyncDeps } from "@/server/deps";
import { errorResponse, readJson } from "@/server/http";
import { requirePlatformAdmin } from "@/server/platform-admin";

export const dynamic = "force-dynamic";

/** The money arrived: the shop's period moves on (and a locked shop opens). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requirePlatformAdmin(request);
    const { id } = await params;
    const change = approveSchema.parse(await readJson(request));
    return NextResponse.json({
      payment: await approvePayment(await getSyncDeps(), admin, id, change),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
