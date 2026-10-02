import { createHmac, timingSafeEqual } from "node:crypto";
import { type Db, ObjectId } from "mongodb";
import { lockoutState } from "@/auth/lockout";
import { isRole, type Role } from "@/auth/permissions";
import { normalizePin, verifyPin } from "@/auth/pin";

/**
 * Who is acting at this counter, decided by the SERVER.
 *
 * Offline, the PIN is checked on the device (there is no server to ask). Online there is one, so
 * it must not take the browser's word for who is working: otherwise anyone at a shared counter
 * could send the owner's id and see cost prices or cancel sales. Entering a PIN online goes to
 * the server, which checks it (with the same wrong-PIN waiting rules) and hands back a short-lived,
 * signed cookie tied to this device. Online reads and writes take the actor only from that cookie.
 */

export const ACTOR_COOKIE = "sa_actor";
/** How long one unlock lasts. The screen also locks itself after a period of inactivity. */
export const ACTOR_TTL_MS = 12 * 60 * 60 * 1000;

interface UserDoc {
  _id: ObjectId;
  storeId: string;
  name: string;
  role: string;
  isActive?: boolean;
  pinSalt?: string;
  pinHash?: string;
}

interface AttemptDoc {
  _id: string;
  failures: number;
  lastFailedAt: number;
}

const users = (db: Db) => db.collection<UserDoc>("user");
const attempts = (db: Db) => db.collection<AttemptDoc>("pinAttempts");

const sign = (payload: string, secret: string) =>
  createHmac("sha256", secret).update(payload).digest("base64url");

/** The cookie value: who, on which device, until when, and a signature over those three. */
export function signActor(
  actor: { userId: string; deviceId: string; expiresAt: number },
  secret: string,
): string {
  const payload = `${actor.userId}.${actor.deviceId}.${actor.expiresAt}`;
  return `${payload}.${sign(payload, secret)}`;
}

/** The user an `sa_actor` cookie vouches for on this device, or null (missing, forged, other device, expired). */
export function readActorCookie(
  cookieHeader: string | null,
  deviceId: string,
  secret: string,
  now: number,
): string | null {
  const raw = cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${ACTOR_COOKIE}=`));
  if (!raw) return null;
  const value = decodeURIComponent(raw.slice(ACTOR_COOKIE.length + 1));
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const [userId, cookieDevice, expires, signature] = parts;
  const expected = Buffer.from(
    sign(`${userId}.${cookieDevice}.${expires}`, secret),
  );
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    return null;
  if (cookieDevice !== deviceId) return null;
  if (!(Number(expires) > now)) return null;
  return userId;
}

export type UnlockResult =
  | { ok: true; cookieValue: string; maxAgeSeconds: number; userId: string }
  | {
      ok: false;
      reason:
        | "UNKNOWN_USER"
        | "NO_PIN"
        | "WRONG_PIN"
        | "LOCKED"
        | "NEEDS_PASSWORD";
      /** For LOCKED: how long to wait. For WRONG_PIN: how many free tries are left. */
      waitMs?: number;
      freeLeft?: number;
    };

/** Checks a PIN on the server and, if right, issues the actor cookie. */
export async function unlockActor(
  db: Db,
  input: {
    storeId: string;
    deviceId: string;
    userId: string;
    pin: string;
    secret: string;
    now?: number;
  },
): Promise<UnlockResult> {
  const now = input.now ?? Date.now();
  const user = ObjectId.isValid(input.userId)
    ? await users(db).findOne({
        _id: new ObjectId(input.userId),
        storeId: input.storeId,
      })
    : null;
  if (!user || user.isActive === false || !isRole(user.role))
    return { ok: false, reason: "UNKNOWN_USER" };
  if (!user.pinHash || !user.pinSalt) return { ok: false, reason: "NO_PIN" };

  const key = `${input.deviceId}:${input.userId}`;
  const before = await attempts(db).findOne({ _id: key });
  const state = lockoutState(
    before?.failures ?? 0,
    before?.lastFailedAt ?? 0,
    now,
  );
  if (state.needsOnlineLogin) return { ok: false, reason: "NEEDS_PASSWORD" };
  if (state.waitMs > 0)
    return { ok: false, reason: "LOCKED", waitMs: state.waitMs };

  const pin = normalizePin(input.pin);
  const correct =
    pin !== null &&
    (await verifyPin(pin, { salt: user.pinSalt, hash: user.pinHash }));

  if (!correct) {
    const after = await attempts(db).findOneAndUpdate(
      { _id: key },
      { $inc: { failures: 1 }, $set: { lastFailedAt: now } },
      { upsert: true, returnDocument: "after" },
    );
    const next = lockoutState(after?.failures ?? 1, now, now);
    return next.needsOnlineLogin
      ? { ok: false, reason: "NEEDS_PASSWORD" }
      : next.freeLeft > 0
        ? { ok: false, reason: "WRONG_PIN", freeLeft: next.freeLeft }
        : { ok: false, reason: "LOCKED", waitMs: next.waitMs };
  }

  await attempts(db).deleteOne({ _id: key });
  const expiresAt = now + ACTOR_TTL_MS;
  return {
    ok: true,
    userId: input.userId,
    maxAgeSeconds: Math.floor(ACTOR_TTL_MS / 1000),
    cookieValue: signActor(
      { userId: input.userId, deviceId: input.deviceId, expiresAt },
      input.secret,
    ),
  };
}

/** Does anyone in this store have a PIN? Then every online action must come with a PIN unlock. */
export async function pinsInUse(db: Db, storeId: string): Promise<boolean> {
  return (
    (await users(db).countDocuments(
      {
        storeId,
        isActive: { $ne: false },
        pinHash: { $exists: true, $ne: "" },
      },
      { limit: 1 },
    )) > 0
  );
}

export interface ActorUser {
  id: string;
  name: string;
  storeId: string;
  role: Role;
}

export type ActorChoice =
  | { kind: "pin"; user: ActorUser }
  /** The store uses PINs but this request has no valid unlock: ask for the PIN. */
  | { kind: "required" }
  /** No PINs in this store: the signed-in account is the person working. */
  | { kind: "account" }
  /** The unlock is for someone who is no longer active (or not in this store). */
  | { kind: "invalid" };

/** Decides who is acting from the device cookie's store and the `sa_actor` cookie. */
export async function chooseActor(
  db: Db,
  input: {
    storeId: string;
    deviceId: string;
    cookieHeader: string | null;
    secret: string;
    now?: number;
  },
): Promise<ActorChoice> {
  const userId = readActorCookie(
    input.cookieHeader,
    input.deviceId,
    input.secret,
    input.now ?? Date.now(),
  );
  if (userId) {
    const user = ObjectId.isValid(userId)
      ? await users(db).findOne({
          _id: new ObjectId(userId),
          storeId: input.storeId,
        })
      : null;
    if (!user || user.isActive === false || !isRole(user.role))
      return { kind: "invalid" };
    return {
      kind: "pin",
      user: {
        id: userId,
        name: user.name,
        storeId: input.storeId,
        role: user.role,
      },
    };
  }
  return (await pinsInUse(db, input.storeId))
    ? { kind: "required" }
    : { kind: "account" };
}
