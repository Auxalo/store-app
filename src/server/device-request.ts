import "server-only";
import type { Db } from "mongodb";
import { checkDevice } from "./devices";
import { HttpError } from "./http";
import { checkRateLimit } from "./rate-limit";
import { noteRequest } from "./request-context";

/**
 * The device making a request, for routes that need only a trusted device (sync, the shop's
 * settings and categories). The same answers everywhere: a device the server does not know or has
 * cut off, a paused shop (403 SHOP_SUSPENDED), and a device asking too often (429).
 */
export async function requireDevice(
  request: Request,
  db: Db,
  kind: "read" | "write",
) {
  noteRequest(request);
  const check = await checkDevice(db, request.headers.get("cookie"));
  if (!check.ok) {
    if (check.reason === "suspended")
      throw new HttpError(403, "SHOP_SUSPENDED");
    throw new HttpError(
      check.reason === "revoked" ? 403 : 401,
      `DEVICE_${check.reason.toUpperCase()}`,
    );
  }
  checkRateLimit(check.device.deviceId, kind);
  noteRequest(request, check.device);
  return check.device;
}
