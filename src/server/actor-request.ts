import "server-only";
import { can, type Permission } from "@/auth/permissions";
import { serverEnv } from "@/lib/env";
import { type ActorUser, chooseActor } from "./actor";
import { assertBillingOpen } from "./billing-gate";
import { getSyncDeps } from "./deps";
import { checkDevice } from "./devices";
import { HttpError } from "./http";
import { checkRateLimit } from "./rate-limit";
import { noteRequest } from "./request-context";
import { requireUser } from "./session";

export interface RequestActor extends ActorUser {
  deviceId: string;
}

/**
 * The person making an online request, for the read and write endpoints.
 *
 * The device cookie says which shop and device this is. If the shop uses PINs, the person must have
 * unlocked with their PIN on this device (the signed `sa_actor` cookie); the browser's say-so is
 * never enough. In a shop with no PINs, the signed-in account is the person working.
 * Their role is read fresh from the database, and `permission` is checked against it. A shop whose
 * subscription is overdue past its grace days is refused (402 BILLING_DUE).
 */
export async function requireActor(
  request: Request,
  permission?: Permission,
  options: { allowLocked?: boolean } = {},
): Promise<RequestActor> {
  noteRequest(request);
  const { db } = await getSyncDeps();
  const cookieHeader = request.headers.get("cookie");
  const device = await checkDevice(db, cookieHeader);
  if (!device.ok)
    throw device.reason === "suspended"
      ? new HttpError(403, "SHOP_SUSPENDED")
      : new HttpError(401, "DEVICE_UNKNOWN");
  checkRateLimit(
    device.device.deviceId,
    request.method === "GET" ? "read" : "write",
  );
  // An overdue subscription closes the shop's screens (402); syncing and paying stay open.
  if (!options.allowLocked) await assertBillingOpen(db, device.device.storeId);

  const choice = await chooseActor(db, {
    storeId: device.device.storeId,
    deviceId: device.device.deviceId,
    cookieHeader,
    secret: serverEnv().BETTER_AUTH_SECRET,
  });
  if (choice.kind === "required") throw new HttpError(401, "PIN_REQUIRED");
  if (choice.kind === "invalid") throw new HttpError(403, "USER_INACTIVE");

  const actor: ActorUser =
    choice.kind === "pin"
      ? choice.user
      : await requireUser(request).then((u) => ({
          id: u.id,
          name: u.name,
          storeId: u.storeId,
          role: u.role,
        }));
  if (actor.storeId !== device.device.storeId)
    throw new HttpError(403, "WRONG_STORE");
  if (permission && !can(actor.role, permission))
    throw new HttpError(403, "FORBIDDEN");
  noteRequest(request, {
    storeId: actor.storeId,
    deviceId: device.device.deviceId,
  });
  return { ...actor, deviceId: device.device.deviceId };
}
