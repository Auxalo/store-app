import { NextResponse } from "next/server";
import { getDb } from "@/db/server/mongo";
import { paymentsQuery } from "@/schemas/billing";
import { listPayments } from "@/server/admin-billing";
import { errorResponse } from "@/server/http";
import { requirePlatformAdmin } from "@/server/platform-admin";

export const dynamic = "force-dynamic";

/** Payments from every shop: the waiting ones (oldest first), or by month and status. */
export async function GET(request: Request) {
  try {
    await requirePlatformAdmin(request);
    const query = paymentsQuery.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    return NextResponse.json({
      payments: await listPayments(await getDb(), query),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
