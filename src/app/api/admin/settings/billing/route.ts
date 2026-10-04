import { NextResponse } from "next/server";
import { getDb } from "@/db/server/mongo";
import { platformBillingSchema } from "@/schemas/billing";
import { getPlatformBilling, savePlatformBilling } from "@/server/billing";
import { errorResponse, readJson } from "@/server/http";
import { requirePlatformAdmin } from "@/server/platform-admin";

export const dynamic = "force-dynamic";

/** Plans, the numbers shops pay to, how new shops start, grace and reminder days. */
export async function GET(request: Request) {
  try {
    await requirePlatformAdmin(request);
    return NextResponse.json({
      settings: await getPlatformBilling(await getDb()),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const admin = await requirePlatformAdmin(request);
    const next = platformBillingSchema.parse(await readJson(request));
    return NextResponse.json({
      settings: await savePlatformBilling(await getDb(), admin, next),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
