import { NextResponse } from "next/server";
import { dayKey } from "@/reports/compute";
import { requireActor } from "@/server/actor-request";
import { serverCash } from "@/server/cash";
import { storeTimeZone } from "@/server/data/service";
import { getSyncDeps } from "@/server/deps";
import { errorResponse } from "@/server/http";

export const dynamic = "force-dynamic";

/** The cash drawer's day: what came in and went out in cash, and what should be in the drawer now. */
export async function GET(request: Request) {
  try {
    const actor = await requireActor(request, "dashboard.view");
    const { db } = await getSyncDeps();
    const timeZone = await storeTimeZone(db, actor.storeId);
    const asked = new URL(request.url).searchParams.get("day") ?? "";
    const day = /^\d{4}-\d{2}-\d{2}$/.test(asked)
      ? asked
      : dayKey(Date.now(), timeZone);
    return NextResponse.json({
      cash: await serverCash(db, actor.storeId, day, timeZone),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
