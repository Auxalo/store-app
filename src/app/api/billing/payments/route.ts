import { NextResponse } from "next/server";
import { submitPaymentSchema } from "@/schemas/billing";
import { requireActor } from "@/server/actor-request";
import { submitPayment } from "@/server/billing";
import { getSyncDeps } from "@/server/deps";
import { errorResponse, readJson } from "@/server/http";
import { checkBudget } from "@/server/rate-limit";

export const dynamic = "force-dynamic";
// A small request: stop it early rather than let it hold a function instance.
export const maxDuration = 10;

const HOUR_MS = 3_600_000;

/** The shop says it sent money (bKash / Nagad). It waits for the operator to check it. */
export async function POST(request: Request) {
  try {
    const actor = await requireActor(request, "billing.manage", {
      allowLocked: true,
    });
    const input = submitPaymentSchema.parse(await readJson(request));
    checkBudget(`billing-pay:${actor.storeId}`, 5, HOUR_MS);
    const { db } = await getSyncDeps();
    const result = await submitPayment(
      db,
      actor.storeId,
      { id: actor.id, name: actor.name },
      input,
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
