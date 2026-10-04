import { NextResponse } from "next/server";
import { getDb } from "@/db/server/mongo";
import { extendSchema } from "@/schemas/billing";
import { extendShop } from "@/server/billing";
import { errorResponse, HttpError, readJson } from "@/server/http";
import { requirePlatformAdmin } from "@/server/platform-admin";

export const dynamic = "force-dynamic";

/** Free extra days for a paying shop (a gift, or to make up for a problem). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requirePlatformAdmin(request);
    const { id } = await params;
    const { days, reason } = extendSchema.parse(await readJson(request));
    const billing = await extendShop(await getDb(), admin, id, days, reason);
    if (!billing) throw new HttpError(404, "NOT_FOUND");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
