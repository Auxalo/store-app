import { NextResponse } from "next/server";
import { getDb } from "@/db/server/mongo";
import { errorResponse, HttpError, readJson } from "@/server/http";
import { requirePlatformAdmin } from "@/server/platform-admin";

export const dynamic = "force-dynamic";

import { ownerSignupSchema } from "@/schemas/auth";
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

/** Creates a shop and its owner (the same as `pnpm shop:create`). */
export async function POST(request: Request) {
  try {
    const admin = await requirePlatformAdmin(request);
    const body = ownerSignupSchema.parse(await readJson(request));
    const result = await createStoreWithOwner(body);
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
