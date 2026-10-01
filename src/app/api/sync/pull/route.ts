import { NextResponse } from "next/server";
import { z } from "zod";
import { getSyncDeps } from "@/server/deps";
import { checkDevice } from "@/server/devices";
import { errorResponse, HttpError } from "@/server/http";
import { handlePull } from "@/server/sync/pull";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  cursor: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

/** Returns changes made by any device after `cursor`. */
export async function GET(request: Request) {
  try {
    const { db } = await getSyncDeps();
    const check = await checkDevice(db, request.headers.get("cookie"));
    if (!check.ok)
      throw new HttpError(
        check.reason === "revoked" ? 403 : 401,
        `DEVICE_${check.reason.toUpperCase()}`,
      );

    const query = querySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    return NextResponse.json(
      await handlePull(db, check.device.storeId, query.cursor, query.limit),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
