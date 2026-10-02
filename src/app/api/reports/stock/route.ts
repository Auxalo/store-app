import { NextResponse } from "next/server";
import { requireActor } from "@/server/actor-request";
import { viewerFor } from "@/server/data/http";
import { stockSummary } from "@/server/data/service";
import { getSyncDeps } from "@/server/deps";
import { errorResponse } from "@/server/http";

export const dynamic = "force-dynamic";

/** What the stock is worth and how much is running low or out (the stock report header). */
export async function GET(request: Request) {
  try {
    const actor = await requireActor(request, "report.view");
    const { db } = await getSyncDeps();
    return NextResponse.json({
      summary: await stockSummary(db, await viewerFor(actor)),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
