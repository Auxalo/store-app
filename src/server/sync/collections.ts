import type { Db } from "mongodb";
import { AUDIT_RETENTION_SECONDS } from "@/lib/constants";

/** Mongo collection names used by the sync engine (business collections match SYNC_COLLECTIONS). */
export const COL = {
  stores: "stores",
  devices: "devices",
  appliedOps: "appliedOps",
  users: "user", // owned by Better Auth
} as const;

const ensured = new WeakSet<Db>();

/** Creates the indexes sync relies on. Idempotent; runs once per process per database. */
export async function ensureSyncIndexes(db: Db): Promise<void> {
  if (ensured.has(db)) return;
  await Promise.all([
    db.collection("categories").createIndex({ storeId: 1, syncSeq: 1 }),
    db.collection("settings").createIndex({ storeId: 1, syncSeq: 1 }),
    db.collection("products").createIndex({ storeId: 1, syncSeq: 1 }),
    db.collection("stockMovements").createIndex({ storeId: 1, syncSeq: 1 }),
    db
      .collection("stockMovements")
      .createIndex({ storeId: 1, productId: 1, createdAt: 1 }),
    db.collection("customers").createIndex({ storeId: 1, syncSeq: 1 }),
    db.collection("sales").createIndex({ storeId: 1, syncSeq: 1 }),
    db.collection("sales").createIndex({ storeId: 1, createdAt: -1 }),
    db.collection("sales").createIndex({ storeId: 1, customerId: 1 }),
    db.collection("ledgerEntries").createIndex({ storeId: 1, syncSeq: 1 }),
    db
      .collection("ledgerEntries")
      .createIndex({ storeId: 1, partyId: 1, createdAt: 1 }),
    ...["suppliers", "purchases", "payments", "expenses", "returns"].map(
      (name) => db.collection(name).createIndex({ storeId: 1, syncSeq: 1 }),
    ),
    db.collection("returns").createIndex({ storeId: 1, kind: 1, refId: 1 }),
    db.collection("purchases").createIndex({ storeId: 1, date: -1 }),
    db
      .collection("payments")
      .createIndex({ storeId: 1, partyId: 1, createdAt: -1 }),
    db.collection("auditLogs").createIndex({ storeId: 1, at: -1 }),
    // The audit log keeps 7 days; MongoDB deletes older rows on its own (within about a minute).
    db
      .collection("auditLogs")
      .createIndex(
        { recordedAt: 1 },
        { expireAfterSeconds: AUDIT_RETENTION_SECONDS },
      ),
    db
      .collection(COL.devices)
      .createIndex({ storeId: 1, code: 1 }, { unique: true }),
    db.collection(COL.appliedOps).createIndex({ storeId: 1 }),
    // Idempotency records only need to outlive any realistic retry window.
    db
      .collection(COL.appliedOps)
      .createIndex(
        { appliedAt: 1 },
        { expireAfterSeconds: 60 * 60 * 24 * 180 },
      ),
  ]);
  ensured.add(db);
}
