import { type Db, ObjectId } from "mongodb";
import { isRole, type Role } from "@/auth/permissions";
import type { PinHash } from "@/auth/pin";
import { clearStoreCaches } from "./cache";
import { COL } from "./sync/collections";

export interface StaffMember {
  id: string;
  name: string;
  username: string;
  role: Role;
  isActive: boolean;
  /** Whether this person has a PIN. (The salt is not secret; the hash is sent only where allowed, see listStaff.) */
  hasPin: boolean;
  pinSalt?: string;
  /** Lets a device check a PIN offline. Only sent to a device that may hold it (see listStaff). */
  pinHash?: string;
}

interface UserDoc {
  _id: ObjectId;
  storeId: string;
  name: string;
  username?: string;
  displayUsername?: string;
  role: string;
  isActive?: boolean;
  pinSalt?: string;
  pinHash?: string;
  /** What signs this person's offline actions (never leaves the server). */
  pinProofKey?: string;
  pinProofKeyPrev?: string;
  pinProofChangedAt?: Date;
}

const toMember = (u: UserDoc): StaffMember => ({
  id: u._id.toHexString(),
  name: u.name,
  username: u.displayUsername ?? u.username ?? "",
  role: isRole(u.role) ? u.role : "cashier",
  isActive: u.isActive !== false,
  hasPin: !!u.pinHash,
  pinSalt: u.pinSalt,
});

const users = (db: Db) => db.collection<UserDoc>(COL.users);
const oid = (id: string) => (ObjectId.isValid(id) ? new ObjectId(id) : null);

/**
 * Who is asking, for deciding whose PIN hash they may receive: the device (which people it was
 * set up by, or where they have entered their PIN online) and the signed-in person.
 */
export interface StaffViewer {
  userId?: string;
  device?: { createdBy?: string; unlockedBy?: string[] };
}

/**
 * The store's people. A person's PIN hash lets a device check their PIN offline, but it also lets
 * whoever holds it guess the PIN. So the hash of an owner or manager reaches only a device where
 * that person has signed in or entered their PIN online (so they can then work there offline), not
 * every device of the shop. Cashiers' hashes go to every device: a cashier's PIN opens nothing
 * more than the cashier can do anyway. Without a viewer, no hashes are sent.
 */
export async function listStaff(
  db: Db,
  storeId: string,
  viewer: StaffViewer = {},
): Promise<StaffMember[]> {
  const found = await users(db).find({ storeId }).sort({ name: 1 }).toArray();
  return found.map((u) => {
    const member = toMember(u);
    const id = member.id;
    const known =
      viewer.userId === id ||
      viewer.device?.createdBy === id ||
      viewer.device?.unlockedBy?.includes(id) === true;
    const hasViewer = !!(viewer.userId || viewer.device);
    return u.pinHash && hasViewer && (member.role === "cashier" || known)
      ? { ...member, pinHash: u.pinHash }
      : member;
  });
}

export type StaffResult =
  | { ok: true; member: StaffMember }
  | { ok: false; error: "NOT_FOUND" | "OWNER_PROTECTED" };

/**
 * Changes a staff member's name, role or active flag. Owners are protected: they cannot be
 * demoted or deactivated here, so a store can never be left without its owner.
 */
export async function updateStaff(
  db: Db,
  storeId: string,
  id: string,
  patch: { name?: string; role?: "manager" | "cashier"; isActive?: boolean },
): Promise<StaffResult> {
  const _id = oid(id);
  const user = _id ? await users(db).findOne({ _id, storeId }) : null;
  if (!_id || !user) return { ok: false, error: "NOT_FOUND" };
  if (
    user.role === "owner" &&
    (patch.role !== undefined || patch.isActive !== undefined)
  ) {
    return { ok: false, error: "OWNER_PROTECTED" };
  }
  const set: Partial<UserDoc> & { updatedAt: Date } = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.role !== undefined) set.role = patch.role;
  if (patch.isActive !== undefined) set.isActive = patch.isActive;
  // Remember when, so work the person did before then (offline, not yet sent) is still accepted.
  const stamp =
    patch.isActive === false && user.isActive !== false
      ? { $set: { ...set, deactivatedAt: new Date() } }
      : patch.isActive === true
        ? { $set: set, $unset: { deactivatedAt: "" } }
        : { $set: set };
  await users(db).updateOne({ _id }, stamp as never);
  clearStoreCaches();
  const updated = await users(db).findOne({ _id });
  return { ok: true, member: toMember(updated as UserDoc) };
}

/** Stores the hash a device computed for this person's PIN (never the PIN itself). */
/** Forgets the wrong-PIN counters of a person (on every device): a new PIN or password starts clean. */
export async function clearPinAttempts(db: Db, id: string): Promise<void> {
  await db
    .collection("pinAttempts")
    .deleteMany({ _id: { $regex: `:${id}$` } } as never);
}

export async function setStaffPin(
  db: Db,
  storeId: string,
  id: string,
  pin: PinHash,
): Promise<StaffResult> {
  const _id = oid(id);
  const user = _id ? await users(db).findOne({ _id, storeId }) : null;
  if (!_id || !user) return { ok: false, error: "NOT_FOUND" };
  // The signing key changes with the PIN. The old one is kept a while: work this person queued
  // on a device before the change is still signed with it.
  await users(db).updateOne({ _id }, {
    $set: {
      pinSalt: pin.salt,
      pinHash: pin.hash,
      updatedAt: new Date(),
      ...(pin.proof ? { pinProofKey: pin.proof } : {}),
      ...(user.pinProofKey
        ? { pinProofKeyPrev: user.pinProofKey, pinProofChangedAt: new Date() }
        : {}),
    },
    ...(pin.proof ? {} : { $unset: { pinProofKey: "" } }),
  } as never);
  await clearPinAttempts(db, id); // a new PIN: the old wrong tries and the "sign in again" lock end
  clearStoreCaches();
  return {
    ok: true,
    member: toMember({ ...user, pinSalt: pin.salt, pinHash: pin.hash }),
  };
}

export async function getStaffMember(
  db: Db,
  storeId: string,
  id: string,
): Promise<StaffMember | null> {
  const _id = oid(id);
  const user = _id ? await users(db).findOne({ _id, storeId }) : null;
  return user ? toMember(user) : null;
}

export interface AuditRow {
  id: string;
  at: string;
  action: string;
  entity: string;
  entityId: string;
  userId: string;
  userName: string;
  oldValue?: unknown;
  newValue?: unknown;
}

/** The store's audit trail, newest first, with the person's name filled in. */
export async function listAudit(
  db: Db,
  storeId: string,
  limit = 100,
  before?: string,
): Promise<AuditRow[]> {
  const rows = await db
    .collection<{
      _id: string;
      at: string;
      action: string;
      entity: string;
      entityId: string;
      userId: string;
      oldValue?: unknown;
      newValue?: unknown;
    }>("auditLogs")
    .find({ storeId, ...(before ? { at: { $lt: before } } : {}) })
    .sort({ at: -1 })
    .limit(limit)
    .toArray();
  const ids = [...new Set(rows.map((r) => r.userId))]
    .map(oid)
    .filter((v): v is ObjectId => v !== null);
  const names = new Map(
    (
      await users(db)
        .find({ _id: { $in: ids } })
        .toArray()
    ).map((u) => [u._id.toHexString(), u.name]),
  );
  return rows.map((r) => ({
    id: r._id,
    at: r.at,
    action: r.action,
    entity: r.entity,
    entityId: r.entityId,
    userId: r.userId,
    userName: names.get(r.userId) ?? "",
    oldValue: r.oldValue,
    newValue: r.newValue,
  }));
}
