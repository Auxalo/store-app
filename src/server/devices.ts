import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Db } from "mongodb";
import { caches } from "./cache";
import { COL } from "./sync/collections";
import type { DeviceAuth } from "./sync/push";

export const DEVICE_COOKIE = "sa_device";

interface DeviceDoc {
  _id: string;
  storeId: string;
  code: string;
  name: string;
  tokenHash: string;
  createdBy: string;
  createdAt: Date;
  lastSeenAt: Date;
  revokedAt?: Date | null;
}

const LAST_SEEN_EVERY_MS = 5 * 60_000;

const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

/** 1 → A, 26 → Z, 27 → AA. Short, human-readable device codes for invoice numbers. */
export function deviceCodeFor(n: number): string {
  let code = "";
  for (let i = n; i > 0; i = Math.floor((i - 1) / 26))
    code = String.fromCharCode(65 + ((i - 1) % 26)) + code;
  return code;
}

export function parseDeviceCookie(
  cookieHeader: string | null,
): { deviceId: string; token: string } | null {
  const raw = cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${DEVICE_COOKIE}=`));
  if (!raw) return null;
  const value = decodeURIComponent(raw.slice(DEVICE_COOKIE.length + 1));
  const dot = value.indexOf(".");
  return dot > 0
    ? { deviceId: value.slice(0, dot), token: value.slice(dot + 1) }
    : null;
}

export type DeviceCheck =
  | { ok: true; device: DeviceAuth & { code: string } }
  | { ok: false; reason: "missing" | "invalid" | "revoked" };

/** Verifies the device cookie. Sync endpoints trust a device, then check each operation's actor. */
export async function checkDevice(
  db: Db,
  cookieHeader: string | null,
): Promise<DeviceCheck> {
  const parsed = parseDeviceCookie(cookieHeader);
  if (!parsed) return { ok: false, reason: "missing" };
  // The device record is kept for a few seconds (this is read by every request). A found record
  // only: a device registered a moment ago is seen at once.
  const doc = (await caches.devices.load(parsed.deviceId, async () => {
    const found = await db
      .collection<DeviceDoc>(COL.devices)
      .findOne({ _id: parsed.deviceId });
    return found ?? undefined;
  })) as DeviceDoc | undefined;
  if (!doc) return { ok: false, reason: "invalid" };
  const expected = Buffer.from(doc.tokenHash, "hex");
  const actual = Buffer.from(hash(parsed.token), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    return { ok: false, reason: "invalid" };
  if (doc.revokedAt) return { ok: false, reason: "revoked" };
  // "Last seen" only needs minute-level accuracy, so it is written at most every 5 minutes (it was a
  // database write on every request), and a failed write never fails the request.
  const now = Date.now();
  if (now - doc.lastSeenAt.getTime() > LAST_SEEN_EVERY_MS) {
    doc.lastSeenAt = new Date(now);
    void db
      .collection<DeviceDoc>(COL.devices)
      .updateOne({ _id: doc._id }, { $set: { lastSeenAt: doc.lastSeenAt } })
      .catch(() => undefined);
  }
  return {
    ok: true,
    device: { storeId: doc.storeId, deviceId: doc._id, code: doc.code },
  };
}

export interface Registration {
  code: string;
  /** Set only when a new token was issued; the caller puts it in the device cookie. */
  token?: string;
}

/**
 * Registers (or re-authorizes) a browser as a trusted device of the store.
 * `existing` is the result of checking the current cookie: when it already authorizes this device
 * nothing changes. Otherwise a fresh token is issued (first install, or the cookie was cleared).
 */
export async function registerDevice(
  db: Db,
  params: {
    storeId: string;
    userId: string;
    deviceId: string;
    name: string;
    existing: DeviceCheck;
  },
): Promise<Registration> {
  const { storeId, userId, deviceId, name, existing } = params;
  const col = db.collection<DeviceDoc>(COL.devices);

  if (
    existing.ok &&
    existing.device.deviceId === deviceId &&
    existing.device.storeId === storeId
  ) {
    return { code: existing.device.code };
  }

  const token = randomBytes(32).toString("base64url");
  const doc = await col.findOne({ _id: deviceId });
  if (doc) {
    if (doc.storeId !== storeId)
      throw new Error("DEVICE_BELONGS_TO_OTHER_STORE");
    if (doc.revokedAt) throw new Error("DEVICE_REVOKED");
    await col.updateOne(
      { _id: deviceId },
      { $set: { tokenHash: hash(token), lastSeenAt: new Date() } },
    );
    caches.devices.delete(deviceId);
    return { code: doc.code, token };
  }

  const store = await db
    .collection<{ _id: string; deviceSeq?: number }>(COL.stores)
    .findOneAndUpdate(
      { _id: storeId },
      { $inc: { deviceSeq: 1 } },
      { returnDocument: "after" },
    );
  if (!store) throw new Error("STORE_NOT_FOUND");
  const code = deviceCodeFor(store.deviceSeq ?? 1);
  const now = new Date();
  await col.insertOne({
    _id: deviceId,
    storeId,
    code,
    name,
    tokenHash: hash(token),
    createdBy: userId,
    createdAt: now,
    lastSeenAt: now,
    revokedAt: null,
  });
  return { code, token };
}

export function deviceCookieValue(deviceId: string, token: string): string {
  return encodeURIComponent(`${deviceId}.${token}`);
}

export interface DeviceInfo {
  id: string;
  code: string;
  name: string;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

export async function listDevices(
  db: Db,
  storeId: string,
): Promise<DeviceInfo[]> {
  const docs = await db
    .collection<DeviceDoc>(COL.devices)
    .find({ storeId })
    .sort({ createdAt: 1 })
    .toArray();
  return docs.map((d) => ({
    id: d._id,
    code: d.code,
    name: d.name,
    createdAt: d.createdAt.toISOString(),
    lastSeenAt: d.lastSeenAt.toISOString(),
    revokedAt: d.revokedAt ? d.revokedAt.toISOString() : null,
  }));
}

export async function renameDevice(
  db: Db,
  storeId: string,
  id: string,
  name: string,
): Promise<boolean> {
  const result = await db
    .collection<DeviceDoc>(COL.devices)
    .updateOne({ _id: id, storeId }, { $set: { name } });
  return result.matchedCount > 0;
}

/** A revoked device is refused by every sync endpoint. Its unsynced work stays safe on the device. */
export async function revokeDevice(
  db: Db,
  storeId: string,
  id: string,
): Promise<boolean> {
  const result = await db
    .collection<DeviceDoc>(COL.devices)
    .updateOne(
      { _id: id, storeId, revokedAt: { $in: [null, undefined] } as never },
      { $set: { revokedAt: new Date() } },
    );
  // Refused from now on by this server; others within the cache's few seconds.
  caches.devices.delete(id);
  return result.matchedCount > 0;
}
