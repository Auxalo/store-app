import { NextResponse } from "next/server";
import { z } from "zod";
import { requireActor } from "@/server/actor-request";
import { getSyncDeps } from "@/server/deps";
import { errorResponse } from "@/server/http";
import { listAudit } from "@/server/staff";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  before: z.string().optional(),
});

/** The audit trail (owner and managers): who did what to prices, stock, sales and users. */
export async function GET(request: Request) {
  try {
    const user = await requireActor(request, "report.view");
    const query = querySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const { db } = await getSyncDeps();
    return NextResponse.json({
      logs: await listAudit(db, user.storeId, query.limit, query.before),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
