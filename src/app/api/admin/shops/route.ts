import { NextResponse } from "next/server";
import { getDb } from "@/db/server/mongo";
import { errorResponse, HttpError, readJson } from "@/server/http";
import { requirePlatformAdmin } from "@/server/platform-admin";

export const dynamic = "force-dynamic";

import { z } from "zod";
import { endOfDhakaDay } from "@/billing/state";
import { ownerSignupSchema } from "@/schemas/auth";
import { dayKeySchema } from "@/schemas/billing";
import { listShops, logAdminAction } from "@/server/admin-shops";
import { createStoreWithOwner, UsernameTakenError } from "@/server/onboarding";

/** All shops (newest first), with who owns them and when a device last used them. */
export async function GET(request: Request) {
  try {
    await requirePlatformAdmin(request);
    const search = new URL(request.url).searchParams.get("q") ?? "";
    return NextResponse.json({
      shops: await listShops(await getDb(), { search }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

const createSchema = ownerSignupSchema.extend({
  billing: z
    .object({
      mode: z.enum(["off", "free", "paid"]),
      trialDays: z.number().int().min(0).max(365).optional(),
      paidUntil: dayKeySchema.optional(),
    })
    .optional(),
});

/** Creates a shop and its owner (the same as `pnpm shop:create`), and how its billing starts. */
export async function POST(request: Request) {
  try {
    const admin = await requirePlatformAdmin(request);
    const body = createSchema.parse(await readJson(request));
    const start = body.billing;
    const until = start?.paidUntil?.split("-").map(Number);
    const result = await createStoreWithOwner(body, {
      mode: start?.mode,
      trialDays: start?.trialDays,
      paidUntil: until
        ? endOfDhakaDay(until[0], until[1] - 1, until[2])
        : undefined,
    });
    await logAdminAction(
      await getDb(),
      admin,
      "shop.create",
      result.storeId,
      body.storeName,
    );
    return NextResponse.json({ storeId: result.storeId }, { status: 201 });
  } catch (error) {
    if (error instanceof UsernameTakenError)
      return errorResponse(new HttpError(409, "USERNAME_TAKEN"));
    return errorResponse(error);
  }
}
