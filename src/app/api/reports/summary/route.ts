import { NextResponse } from "next/server";
import { z } from "zod";
import { can } from "@/auth/permissions";
import { requireActor } from "@/server/actor-request";
import { storeTimeZone } from "@/server/data/service";
import { getSyncDeps } from "@/server/deps";
import { errorResponse } from "@/server/http";
import { hideProfit, serverSummaryCached } from "@/server/reports";

export const dynamic = "force-dynamic";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const querySchema = z
  .object({ from: day, to: day })
  .refine((q) => q.from <= q.to);
const MAX_DAYS = 366;

/** Report totals for a date range, computed from the server's copy (owner and managers). */
export async function GET(request: Request) {
  try {
    // The person who unlocked this device (not just the signed-in account), as for every online read.
    const actor = await requireActor(request, "report.view");
    const { from, to } = querySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_DAYS)
      return NextResponse.json({ code: "RANGE_TOO_LARGE" }, { status: 400 });
    const { db } = await getSyncDeps();
    // The shop's own time zone, as the dashboard uses, so the same day means the same hours.
    const timeZone = await storeTimeZone(db, actor.storeId);
    const summary = await serverSummaryCached(
      db,
      actor.storeId,
      { from, to },
      timeZone,
    );
    // Cost and profit are for people who may see them.
    if (!can(actor.role, "profit.view"))
      return NextResponse.json({ summary: hideProfit(summary) });
    return NextResponse.json({ summary });
  } catch (error) {
    return errorResponse(error);
  }
}
