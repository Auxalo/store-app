import { type Db, ObjectId } from "mongodb";
import { isRole, type Role } from "@/auth/permissions";
import type { PinHash } from "@/auth/pin";
import { COL } from "./sync/collections";

export interface StaffMember {
  id: string;
  name: string;
  username: string;
  role: Role;
  isActive: boolean;
  /** Lets devices check a PIN offline. See src/auth/pin.ts for what this does and does not protect. */
  pinSalt?: string;
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
}

const toMember = (u: UserDoc): StaffMember => ({
  id: u._id.toHexString(),
  name: u.name,
  username: u.displayUsername ?? u.username ?? "",
  role: isRole(u.role) ? u.role : "cashier",
  isActive: u.isActive !== false,
  pinSalt: u.pinSalt,
  pinHash: u.pinHash,
});

const users = (db: Db) => db.collection<UserDoc>(COL.users);
const oid = (id: string) => (ObjectId.isValid(id) ? new ObjectId(id) : null);

export async function listStaff(
  db: Db,
  storeId: string,
): Promise<StaffMember[]> {
  const found = await users(db).find({ storeId }).sort({ name: 1 }).toArray();
  return found.map(toMember);
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
  await users(db).updateOne({ _id }, { $set: set });
  const updated = await users(db).findOne({ _id });
  return { ok: true, member: toMember(updated as UserDoc) };
}

/** Stores the hash a device computed for this person's PIN (never the PIN itself). */
export async function setStaffPin(
  db: Db,
  storeId: string,
  id: string,
  pin: PinHash,
): Promise<StaffResult> {
  const _id = oid(id);
  const user = _id ? await users(db).findOne({ _id, storeId }) : null;
  if (!_id || !user) return { ok: false, error: "NOT_FOUND" };
  await users(db).updateOne(
    { _id },
    {
      $set: {
        pinSalt: pin.salt,
        pinHash: pin.hash,
        updatedAt: new Date(),
      } as never,
    },
  );
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
