import { NextResponse } from "next/server";
import { can } from "@/auth/permissions";
import { requireActor } from "@/server/actor-request";
import { shopBillingView } from "@/server/billing";
import { getSyncDeps } from "@/server/deps";
import { errorResponse } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * The shop's billing page: where it stands, its plans, where to send money and its payments. Open
 * while the shop is locked (this is where a locked shop is sent). Someone who cannot pay (a
 * cashier) is only told where the shop stands.
 */
export async function GET(request: Request) {
  try {
    const actor = await requireActor(request, undefined, { allowLocked: true });
    const { db } = await getSyncDeps();
    return NextResponse.json(
      await shopBillingView(
        db,
        actor.storeId,
        can(actor.role, "billing.manage"),
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
