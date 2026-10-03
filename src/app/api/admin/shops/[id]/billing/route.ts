import { NextResponse } from "next/server";
import { getDb } from "@/db/server/mongo";
import { shopBillingSchema } from "@/schemas/billing";
import { setShopBilling } from "@/server/billing";
import { errorResponse, HttpError, readJson } from "@/server/http";
import { requirePlatformAdmin } from "@/server/platform-admin";

export const dynamic = "force-dynamic";

/** Changes a shop's billing: off / free / paid, its plan, an agreed price, grace days, the end date. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requirePlatformAdmin(request);
    const { id } = await params;
    const patch = shopBillingSchema.parse(await readJson(request));
    const billing = await setShopBilling(await getDb(), admin, id, patch);
    if (!billing) throw new HttpError(404, "NOT_FOUND");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
