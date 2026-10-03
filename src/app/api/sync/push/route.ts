import { NextResponse } from "next/server";
import { MIN_APP_VERSION } from "@/lib/app-version";
import { pushRequestSchema } from "@/schemas/sync";
import { getSyncDeps } from "@/server/deps";
import { requireDevice } from "@/server/device-request";
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
    const device = await requireDevice(request, deps.db, "write");

    const body = pushRequestSchema.parse(await readJson(request));
    if (body.deviceId !== device.deviceId)
      throw new HttpError(403, "DEVICE_MISMATCH");
    if (compareVersions(body.appVersion, MIN_APP_VERSION) < 0)
      throw new HttpError(426, "UPGRADE_REQUIRED");

    return NextResponse.json(await handlePush(deps, device, body));
  } catch (error) {
    return errorResponse(error);
  }
}
