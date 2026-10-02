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
    // Searching and sorting lists on the server (see src/lib/search-fields.ts).
    db.collection("sales").createIndex({ storeId: 1, searchWords: 1 }),
    db.collection("sales").createIndex({ storeId: 1, invoiceNo: 1 }),
    db
      .collection("sales")
      .createIndex({ storeId: 1, status: 1, createdAt: -1 }),
    // One index per way a list can be sorted, ending in _id (the tie-break goes the same way as the
    // sort), so any list opens straight from an index in either direction, even with 200,000 rows.
    ...(
      [
        ["products", { stock: 1 }],
        ["products", { sellingPrice: 1 }],
        ["products", { createdAt: -1 }],
        ["products", { lowStockThreshold: -1 }],
        ["customers", { balance: -1 }],
        ["customers", { createdAt: -1 }],
        ["suppliers", { balance: -1 }],
        ["suppliers", { createdAt: -1 }],
        ["sales", { createdAt: -1 }],
        ["sales", { total: -1 }],
        ["sales", { due: -1 }],
        ["purchases", { date: -1, createdAt: -1 }],
        ["purchases", { total: -1 }],
        ["purchases", { due: -1 }],
        ["expenses", { date: -1, createdAt: -1 }],
        ["expenses", { amount: -1 }],
        ["payments", { createdAt: -1 }],
        ["payments", { amount: -1 }],
        ["returns", { createdAt: -1 }],
        ["returns", { total: -1 }],
        ["stockMovements", { createdAt: -1 }],
      ] as const
    ).map(([name, keys]) =>
      db.collection(name).createIndex({
        storeId: 1,
        ...keys,
        // The id goes the way the first key goes (that is how the tie-break is defined).
        ...("lowStockThreshold" in keys
          ? {}
          : { _id: Object.values(keys)[0] as 1 | -1 }),
      }),
    ),
    ...["products", "customers", "suppliers"].flatMap((name) => [
      db.collection(name).createIndex({ storeId: 1, searchWords: 1 }),
      db.collection(name).createIndex({ storeId: 1, nameKey: 1, _id: 1 }),
    ]),
    db.collection("products").createIndex({ storeId: 1, sku: 1 }),
    db.collection("products").createIndex({ storeId: 1, barcode: 1 }),
    db.collection("purchases").createIndex({ storeId: 1, searchWords: 1 }),
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
