import { NextResponse } from "next/server";
import { getDb } from "@/db/server/mongo";
import { recordPaymentSchema } from "@/schemas/billing";
import { listPayments } from "@/server/admin-billing";
import { recordManualPayment } from "@/server/billing";
import { getSyncDeps } from "@/server/deps";
import { errorResponse, readJson } from "@/server/http";
import { requirePlatformAdmin } from "@/server/platform-admin";

export const dynamic = "force-dynamic";

/** This shop's payments, newest first. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requirePlatformAdmin(request);
    const { id } = await params;
    return NextResponse.json({
      payments: await listPayments(await getDb(), { storeId: id, limit: 100 }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** A payment the operator took themselves (cash, or one that came in another way). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requirePlatformAdmin(request);
    const { id } = await params;
    const input = recordPaymentSchema.parse(await readJson(request));
    return NextResponse.json(
      {
        payment: await recordManualPayment(
          await getSyncDeps(),
          admin,
          id,
          input,
        ),
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
