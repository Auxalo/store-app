import { randomUUID } from "node:crypto";
import { type Db, ObjectId } from "mongodb";
import { getAuth } from "@/auth/server";
import { PLATFORM_STORE_ID } from "@/lib/constants";
import { clearStoreCaches } from "./cache";
import type { ShopStatus } from "./shop-status";

/** What the operator can see and do about the shops. Every action is written to `platformAudit`. */

export interface ShopRow {
  id: string;
  name: string;
  status: ShopStatus;
  createdAt: string | null;
  owner: { name: string; username: string } | null;
  devices: number;
  lastSeenAt: string | null;
}

export interface ShopDetail extends ShopRow {
  counts: Record<string, number>;
  people: Array<{
    name: string;
    username: string;
    role: string;
    isActive: boolean;
  }>;
}

const iso = (value: unknown): string | null =>
  value instanceof Date
    ? value.toISOString()
    : typeof value === "string"
      ? value
      : null;

const escapeRegex = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function listShops(
  db: Db,
  options: { search?: string; limit?: number; ids?: string[] } = {},
): Promise<ShopRow[]> {
  const search = options.search?.trim();
  const filter = search
    ? { name: { $regex: escapeRegex(search), $options: "i" } }
    : {};
  const stores = await db
    .collection<{
      _id: string;
      name?: string;
      status?: string;
      createdAt?: unknown;
    }>("stores")
    .find({
      ...filter,
      _id: options.ids ? { $in: options.ids } : { $ne: PLATFORM_STORE_ID },
    })
    .sort({ createdAt: -1 })
    .limit(Math.min(options.limit ?? 300, 500))
    .toArray();
  const ids = stores.map((s) => s._id);
  if (ids.length === 0) return [];

  const [owners, devices] = await Promise.all([
    db
      .collection("user")
      .find({ storeId: { $in: ids }, role: "owner" })
      .project({ storeId: 1, name: 1, username: 1 })
      .toArray(),
    db
      .collection("devices")
      .aggregate([
        { $match: { storeId: { $in: ids } } },
        {
          $group: {
            _id: "$storeId",
            n: { $sum: 1 },
            last: { $max: "$lastSeenAt" },
          },
        },
      ])
      .toArray(),
  ]);
  const ownerOf = new Map(owners.map((o) => [String(o.storeId), o]));
  const deviceOf = new Map(devices.map((d) => [String(d._id), d]));

  return stores.map((s) => {
    const owner = ownerOf.get(s._id);
    const device = deviceOf.get(s._id);
    return {
      id: s._id,
      name: String(s.name ?? ""),
      status: s.status === "suspended" ? "suspended" : "active",
      createdAt: iso(s.createdAt),
      owner: owner
        ? {
            name: String(owner.name ?? ""),
            username: String(owner.username ?? ""),
          }
        : null,
      devices: Number(device?.n ?? 0),
      lastSeenAt: iso(device?.last),
    };
  });
}

export async function shopDetail(
  db: Db,
  storeId: string,
): Promise<ShopDetail | null> {
  const [row] = await listShops(db, { ids: [storeId], limit: 1 });
  if (!row || row.id === PLATFORM_STORE_ID) return null;
  const count = (name: string, extra: Record<string, unknown> = {}) =>
    db.collection(name).countDocuments({ storeId, ...extra });
  const [products, customers, suppliers, sales, devices, people] =
    await Promise.all([
      count("products", { deletedAt: null }),
      count("customers", { deletedAt: null }),
      count("suppliers", { deletedAt: null }),
      count("sales"),
      count("devices", { revokedAt: null }),
      db.collection("user").find({ storeId }).sort({ name: 1 }).toArray(),
    ]);
  return {
    ...row,
    counts: { products, customers, suppliers, sales, activeDevices: devices },
    people: people.map((u) => ({
      name: String(u.name ?? ""),
      username: String(u.username ?? ""),
      role: String(u.role ?? ""),
      isActive: u.isActive !== false,
    })),
  };
}

export interface AdminActor {
  id: string;
  name: string;
}

export async function logAdminAction(
  db: Db,
  admin: AdminActor,
  action: string,
  storeId: string | null,
  detail = "",
): Promise<void> {
  await db.collection("platformAudit").insertOne({
    _id: randomUUID(),
    at: new Date(),
    adminId: admin.id,
    adminName: admin.name,
    action,
    storeId,
    detail,
  } as never);
}

export async function recentAdminActions(db: Db, limit = 100) {
  const rows = await db
    .collection("platformAudit")
    .find({})
    .sort({ at: -1 })
    .limit(Math.min(limit, 500))
    .toArray();
  return rows.map((r) => ({
    id: String(r._id),
    at: iso(r.at),
    admin: String(r.adminName ?? ""),
    action: String(r.action ?? ""),
    storeId: (r.storeId as string | null) ?? null,
    detail: String(r.detail ?? ""),
  }));
}

/** Pauses or resumes a shop. Its devices and sign-ins are refused until it is resumed. */
export async function setShopStatus(
  db: Db,
  admin: AdminActor,
  storeId: string,
  status: ShopStatus,
): Promise<boolean> {
  const result = await db
    .collection<{ _id: string }>("stores")
    .updateOne({ _id: storeId }, { $set: { status, updatedAt: new Date() } });
  if (result.matchedCount === 0) return false;
  clearStoreCaches(); // this server obeys at once; the others within a few seconds
  await logAdminAction(
    db,
    admin,
    status === "suspended" ? "shop.suspend" : "shop.resume",
    storeId,
  );
  return true;
}

/** Sets a new password for a shop's owner and ends their sessions. Returns false if there is no owner. */
export async function resetOwnerPassword(
  db: Db,
  admin: AdminActor,
  storeId: string,
  password: string,
): Promise<boolean> {
  const owner = await db.collection("user").findOne({ storeId, role: "owner" });
  if (!owner) return false;
  const ctx = await (await getAuth()).$context;
  await ctx.internalAdapter.updatePassword(
    String(owner._id),
    await ctx.password.hash(password),
  );
  await db.collection("session").deleteMany({
    userId: {
      $in: [String(owner._id), new ObjectId(String(owner._id))],
    } as never,
  });
  await logAdminAction(
    db,
    admin,
    "shop.resetOwnerPassword",
    storeId,
    String(owner.username ?? ""),
  );
  return true;
}
