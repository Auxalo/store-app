import { NextResponse } from "next/server";
import { z } from "zod";
import { requireActor } from "@/server/actor-request";
import { storeTimeZone } from "@/server/data/service";
import { getSyncDeps } from "@/server/deps";
import { errorResponse } from "@/server/http";
import { serverMovementSummary } from "@/server/movements";

export const dynamic = "force-dynamic";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const querySchema = z
  .object({ from: day, to: day })
  .refine((q) => q.from <= q.to);
const MAX_DAYS = 366;

/** What went in and out of stock, product by product, for a date range (the stock log's cards). */
export async function GET(request: Request) {
  try {
    const actor = await requireActor(request, "report.view");
    const { from, to } = querySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_DAYS)
      return NextResponse.json({ code: "RANGE_TOO_LARGE" }, { status: 400 });
    const { db } = await getSyncDeps();
    const timeZone = await storeTimeZone(db, actor.storeId);
    return NextResponse.json({
      summary: await serverMovementSummary(
        db,
        actor.storeId,
        { from, to },
        timeZone,
      ),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
