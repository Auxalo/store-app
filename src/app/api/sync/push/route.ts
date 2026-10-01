import { NextResponse } from "next/server";
import { MIN_APP_VERSION } from "@/lib/app-version";
import { pushRequestSchema } from "@/schemas/sync";
import { getSyncDeps } from "@/server/deps";
import { checkDevice } from "@/server/devices";
import {
  compareVersions,
  errorResponse,
  HttpError,
  readJson,
} from "@/server/http";
import { handlePush } from "@/server/sync/push";

export const dynamic = "force-dynamic";

/** Applies a batch of queued operations. Safe to call repeatedly with the same operations. */
export async function POST(request: Request) {
  try {
    const deps = await getSyncDeps();
    const check = await checkDevice(deps.db, request.headers.get("cookie"));
    if (!check.ok)
      throw new HttpError(
        check.reason === "revoked" ? 403 : 401,
        `DEVICE_${check.reason.toUpperCase()}`,
      );

    const body = pushRequestSchema.parse(await readJson(request));
    if (body.deviceId !== check.device.deviceId)
      throw new HttpError(403, "DEVICE_MISMATCH");
    if (compareVersions(body.appVersion, MIN_APP_VERSION) < 0)
      throw new HttpError(426, "UPGRADE_REQUIRED");

    return NextResponse.json(await handlePush(deps, check.device, body));
  } catch (error) {
    return errorResponse(error);
  }
}
