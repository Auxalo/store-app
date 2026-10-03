import { NextResponse } from "next/server";
import { getDb } from "@/db/server/mongo";
import { rejectSchema } from "@/schemas/billing";
import { rejectPayment } from "@/server/billing";
import { errorResponse, readJson } from "@/server/http";
import { requirePlatformAdmin } from "@/server/platform-admin";

export const dynamic = "force-dynamic";

/** The money did not arrive (or not that much): the shop sees the reason. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requirePlatformAdmin(request);
    const { id } = await params;
    const { reason } = rejectSchema.parse(await readJson(request));
    return NextResponse.json({
      payment: await rejectPayment(await getDb(), admin, id, reason),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
